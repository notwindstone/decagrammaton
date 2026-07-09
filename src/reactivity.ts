// Thin re-export of @sigrea/core — decagrammaton's reactivity layer.
//
// This replaces the old coarse `src/reactivity/wrapper.ts` (a single
// version-signal Proxy). sigrea gives us fine-grained per-key reactivity plus
// `Scope` for per-component-instance lifecycle/effect disposal, which retires
// the old `detached()` / `setActiveSub(undefined)` hack in the renderer.
//
// The public `.value` ergonomics developers write in `<script setup>` come
// straight from sigrea: `signal(0).value`, `computed(() => ...).value`.

export {
  // signals
  signal,
  computed,
  isComputed,
  // deep signals
  deepSignal,
  shallowDeepSignal,
  readonlyDeepSignal,
  readonlyShallowDeepSignal,
  toRawDeepSignal,
  isDeepSignal,
  // readonly / conversion
  readonly,
  toSignal,
  markRaw,
  isRaw,
  // watchers
  watch,
  watchEffect,
  nextTick,
  // reactivity helpers
  isSignal,
  toValue,
  pauseTracking,
  resumeTracking,
  untracked,
  // scope / lifecycle
  Scope,
  createScope,
  runWithScope,
  getCurrentScope,
  onDispose,
  disposeScope,
  onMount,
  onUnmount,
} from "@sigrea/core";

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
