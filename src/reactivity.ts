// Thin re-export of @sigrea/core — decagrammaton's reactivity layer.
//
// This replaces the old coarse `src/reactivity/wrapper.ts` (a single
// version-signal Proxy). sigrea gives us fine-grained per-key reactivity plus
// `Scope` for per-component-instance lifecycle/effect disposal, which retires
// the old `detached()` / `setActiveSub(undefined)` hack in the renderer.
//
// The public `.value` ergonomics developers write in `<script setup>` come
// straight from sigrea: `signal(0).value`, `computed(() => ...).value`.

import { deepSignal as deepSignalImpl, type Signal } from "@sigrea/core";

export {
  // signals
  signal,
  signal as shallowRef, // Vue 3: signal tracks only root `.value`, like shallowRef.
  computed,
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
  readonly,
  toSignal,
  toSignal as toRef, // Vue 3.
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

export type {
  Signal,
  Signal as Ref, // Vue 3.
  Signal as ShallowRef, // Vue 3: signal is shallow.
  Computed,
  Computed as ComputedRef, // Vue 3.
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
export function ref<T>(source?: T): Signal<T | undefined> {
  return deepSignalImpl({ value: source, __v_isSignal: true }) as unknown as Signal<T | undefined>;
}
