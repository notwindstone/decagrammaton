// Thin re-export of @sigrea/core — decagrammaton's reactivity layer.
//
// This replaces the old coarse `src/reactivity/wrapper.ts` (a single
// version-signal Proxy). sigrea gives us fine-grained per-key reactivity plus
// `Scope` for per-component-instance lifecycle/effect disposal, which retires
// the old `detached()` / `setActiveSub(undefined)` hack in the renderer.
//
// The public `.value` ergonomics developers write in `<script setup>` come
// straight from sigrea: `signal(0).value`, `computed(() => ...).value`.

import {
  signal as signalImpl,
  computed as computedImpl,
  readonly as readonlyImpl,
  toSignal as toSignalImpl,
  deepSignal as deepSignalImpl,
} from "@sigrea/core";
// The `.value` boxes' RETURN TYPES borrow Vue's branded `Ref`, not sigrea's
// `Signal`. Volar type-checks templates by unwrapping `T extends Ref<infer V> ?
// V : T`, and Vue's `Ref` is tagged with a non-exported `unique symbol`
// (`RefSymbol`) that only Vue's own type carries. sigrea's boxes (`Signal<T>` is
// a `Pick<…, "value" | "peek">`, likewise `Computed`/`ReadonlySignal`) lack that
// brand, so Volar treats them as plain `{ value }` objects and does NOT unwrap
// them — making `@click="count++"` a TS2356 ("operand must be number") in the
// template. Importing Vue's `Ref` by TYPE only keeps the runtime on sigrea while
// giving the template the brand it keys off. `vue` is a peerDependency: the
// consumer's Vue is deduped, so this `RefSymbol` is the SAME unique symbol Volar
// reads — a bundled copy would be a different symbol and would not match.
import type { Ref } from "vue";
import type {
  Signal,
  Computed,
  ReadonlySignal,
  DeepSignal,
  ReadonlyDeepSignal,
} from "@sigrea/core";

export {
  // signals
  isComputed,
  // deep signals
  deepSignal,
  deepSignal as reactive, // Vue 3: deep proxy, direct property access.
  shallowDeepSignal,
  shallowDeepSignal as shallowReactive, // Vue 3: root-level tracking only.
  readonlyDeepSignal,
  readonlyShallowDeepSignal,
  readonlyShallowDeepSignal as shallowReadonly, // Vue 3.
  toRawDeepSignal,
  toRawDeepSignal as toRaw, // Vue 3.
  isDeepSignal,
  isDeepSignal as isReactive, // Vue 3.
  // readonly / conversion
  markRaw,
  isRaw,
  // watchers
  watch,
  watchEffect,
  nextTick,
  // reactivity helpers
  isSignal,
  isSignal as isRef, // Vue 3: signals are ref-like.
  toValue,
  pauseTracking,
  resumeTracking,
  untracked,
  // scope / lifecycle
  Scope,
  Scope as EffectScope, // Vue 3.
  createScope,
  createScope as effectScope, // Vue 3.
  runWithScope,
  getCurrentScope,
  onDispose,
  onDispose as onScopeDispose, // Vue 3.
  disposeScope,
  onMount,
  onMount as onMounted, // Vue 3.
  onUnmount,
  onUnmount as onUnmounted, // Vue 3.
} from "@sigrea/core";

// ── branded `.value` boxes ───────────────────────────────────────────────────
//
// `signal`/`shallowRef`, `computed`, `readonly` (signal overload) and `toRef`
// all hand back sigrea boxes read via `.value` in templates, so all four need
// Vue's `RefSymbol` brand for Volar to unwrap them (see the `import type { Ref }`
// note above). We re-type each by intersecting the sigrea box with `Ref<T>`.
// The intersection keeps everything: it stays assignable to sigrea's `Signal` /
// `Computed` (so `watch()` still accepts it), keeps `.peek()`, and adds the
// brand. Readonly variants intersect with `Readonly<Ref<T>>` instead — the
// `readonly` mapped modifier drops the `.value` setter, so the box unwraps in
// templates AND keeps `.value` read-only (`ReadonlySignal` alone would unwrap to
// a plain object; a bare `Ref` would wrongly make `.value` writable).
//
// The runtime binding is the untouched sigrea function — only the visible type
// changes (the `as unknown as …` cast), so `dist/*.js` carries zero Vue imports.
type ShallowRefBox<T> = Signal<T> & Ref<T>;
type ComputedBox<T> = Computed<T> & Ref<T>;
type ReadonlyBox<T> = ReadonlySignal<T> & Readonly<Ref<T>>;

type SignalFn = {
  <T>(): ShallowRefBox<T | undefined>;
  <T>(value: T): ShallowRefBox<T>;
};
type ComputedFn = {
  <T>(getter: () => T): ComputedBox<T>;
  <T>(options: { get: () => T; set: (value: T) => void }): ComputedBox<T>;
};
type ReadonlyFn = {
  <T>(source: Signal<T> | Computed<T>): ReadonlyBox<T>;
  <T extends object>(source: DeepSignal<T>): ReadonlyDeepSignal<T>;
};
type ToSignalFn = <TSource extends object, TKey extends keyof TSource>(
  source: TSource,
  key: TKey,
) => ReadonlyBox<TSource[TKey]>;

export const signal = signalImpl as unknown as SignalFn;
export { signal as shallowRef }; // Vue 3: signal tracks only root `.value`, like shallowRef.
export const computed = computedImpl as unknown as ComputedFn;
export const readonly = readonlyImpl as unknown as ReadonlyFn;
export const toSignal = toSignalImpl as unknown as ToSignalFn;
export { toSignal as toRef }; // Vue 3.

// `Ref` is Vue's branded type (re-exported below), NOT sigrea's `Signal` — so a
// consumer's `import type { Ref } from "decagrammaton"` matches what `ref()`
// returns and template unwrapping keys off the brand. `ShallowRef`/`ComputedRef`
// are the branded box shapes above, so an explicit `let x: ShallowRef<number>`
// annotation unwraps in templates the same way the inferred return type does.
export type { Ref } from "vue";
export type ShallowRef<T> = ShallowRefBox<T>; // Vue 3: signal is shallow.
export type ComputedRef<T> = ComputedBox<T>; // Vue 3.

export type {
  Signal,
  Computed,
  DeepSignal,
  ReadonlyDeepSignal,
  ShallowDeepSignal,
  ReadonlyShallowDeepSignal,
  ReadonlySignal,
  WatchHandle,
  WatchStopHandle,
  WatchOptions,
  WatchCallback,
  WatchSource,
  WatchEffect,
  Cleanup,
} from "@sigrea/core";

// ── ref: the one Vue 3 primitive sigrea has no name for ──────────────────────
//
// sigrea gives us `signal` (a shallow `.value` box) and `deepSignal` (a deep
// reactive proxy, accessed directly — no `.value`). Vue's `ref` is the hybrid:
// a `.value` box whose object contents stay deeply reactive, *including across
// reassignment* — `r.value = {…}; r.value.x = 1` still triggers.
//
// `signal(deepSignal(x))` fails that last part: signal's setter stores the raw
// object on reassign, so the new object isn't deep-wrapped. deepSignal's own get
// trap DOES re-wrap raw values on read, so we build ref *on* deepSignal instead:
// a deep proxy shaped `{ value }`. The `__v_isSignal` marker is what sigrea's
// `isSignal` checks (`src["__v_isSignal"] === true`) — the template unwrap in
// createContext keys off `isSignal`, so without it `{{ r }}` renders
// `[object Object]`. sigrea's `SignalFlags` enum is type-only (not a runtime
// export), so the string is written literally here; it is sigrea's interop
// contract, mirroring Vue's own `__v_isRef` template marker.
export function ref<T>(source: T): Ref<T> {
  return deepSignalImpl({ value: source, __v_isSignal: true }) as unknown as Ref<T>;
}
