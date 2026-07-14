// Component lifecycle hooks: onMounted / onUnmounted (Vue 3 names).
//
// WHY THIS EXISTS (and is not a sigrea re-export): sigrea ships `onMount` /
// `onUnmount`, but they require an active *mount-job registry* that only
// sigrea's `molecule()` factory ever pushes (see @sigrea/core dist index.mjs —
// `pushMountJobRegistry` is called solely inside `createMoleculeFactory`).
// decagrammaton does NOT build components as molecules — `createApp.mount` /
// `createComponent` run setup with raw `runWithScope` + `runWithInstance` — so a
// bare re-export of sigrea's `onMount` throws "can only be called during
// molecule setup" the instant a user calls it. decagrammaton owns its own tiny
// registry instead, the same way it owns `currentInstance` separately from the
// sigrea Scope.
//
// TIMING (decided with the user): decagrammaton mounts synchronously — there is
// no async scheduler — and `onMounted` fires AFTER the full (sub)tree is in the
// live DOM. render() assembles the whole element tree detached, and the mounting
// site (createApp.mount, or createIf/createFor on a reactive remount) inserts it
// in one shot; the batch is flushed right after that insertion, so every
// `onMounted` callback sees its nodes actually in the document.
//
// ORDERING: callbacks fire LIFO. A parent's setup runs BEFORE its descendants'
// (render creates children depth-first), so it registers first; firing in
// reverse runs the deepest component first — child `onMounted` before parent
// `onMounted`, matching Vue's core guarantee. (Vue's exact interleaving of
// unrelated sibling subtrees is finer than this and is not a contract we mirror;
// the parent-after-all-descendants invariant is.)

import { getCurrentScope, runWithScope, onDispose, type Scope } from "../reactivity.ts";
import { getCurrentInstance, runWithInstance, type ComponentInstance } from "./instance.ts";

// The active mount batch: callbacks collected during the current synchronous
// mount pass. `null` when no mount is in flight — calling onMounted then is the
// "outside setup" error. A single flat batch is shared across the whole pass;
// nested mount sites push into whichever batch the outermost one opened.
let currentBatch: Array<() => void> | null = null;

// Open a mount batch if none is active. Returns true when THIS call opened it,
// making the caller responsible for the matching flush. A nested mount site
// (createIf during the initial render, a child createComponent, …) sees a batch
// already open and returns false, so only the outermost site flushes — deferring
// every onMounted to after the whole tree lands in the DOM.
export function openMountBatch(): boolean {
  if (currentBatch === null) {
    currentBatch = [];
    return true;
  }
  return false;
}

// Flush and clear the current batch, LIFO (see ORDERING above). Reset happens
// BEFORE running callbacks so a callback that itself triggers a reactive remount
// (opening a fresh batch) is isolated from this one.
export function flushMountBatch(): void {
  const batch = currentBatch;
  currentBatch = null;
  if (batch === null) return;
  for (let i = batch.length - 1; i >= 0; i--) batch[i]();
}

// onMounted(cb) — run `cb` once the component's nodes are in the DOM. The scope
// and instance active at registration are captured and re-established when the
// callback fires (the mount brackets have exited by flush time), so a watch/
// effect created inside `onMounted` still registers on the component scope and is
// disposed with it — and inject() inside the callback walks the right lineage.
export function onMounted(cb: () => void): void {
  if (currentBatch === null) {
    throw new Error("onMounted() can only be called synchronously during setup().");
  }
  const scope: Scope | undefined = getCurrentScope();
  const instance: ComponentInstance | null = getCurrentInstance();
  currentBatch.push(() => {
    const run = () => runWithInstance(instance, cb);
    if (scope) runWithScope(scope, run);
    else run();
  });
}

// onUnmounted(cb) — run `cb` when the component tears down. A component's teardown
// IS its scope's disposal (createApp.mount returns `() => scope.dispose()`; a
// child scope disposes with its parent; a v-if branch / v-for row disposes its
// own scope), so onUnmounted is exactly an onDispose on the setup-time scope. No
// separate unmount pass is needed — unlike onMounted, disposal already runs
// cleanups in the right order.
export function onUnmounted(cb: () => void): void {
  const scope: Scope | undefined = getCurrentScope();
  if (currentBatch === null || scope === undefined) {
    throw new Error("onUnmounted() can only be called synchronously during setup().");
  }
  onDispose(cb, scope);
}
