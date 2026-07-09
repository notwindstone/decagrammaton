import type { SafeElement, SafeTextNode, EventHandler, EventCleanup } from "ark-of-atrahasis";
import {
  watchEffect,
  isSignal,
  onDispose,
  getCurrentScope,
  createScope,
  runWithScope,
  type WatchHandle,
  type Scope,
} from "../reactivity.ts";
import { EVENT_METHODS } from "../compiler/tables.ts";

// The runtime helpers that codegen output calls. Imported by generated render
// modules from "decagrammaton/runtime".

type SafeNode = SafeElement | SafeTextNode;

// A reactive binding that must apply to the DOM synchronously. sigrea's
// watchEffect defaults to "pre" (async) flush; template bindings need "sync" so
// text/attr updates land immediately, matching the old alien-signals `effect`.
//
// Cleanup is NOT registered here: watchEffect -> watch -> watchImmediate already
// calls `onDispose(() => watcher.stop(), scope)` when a scope is active (sigrea
// dist index.mjs:2382). renderEffect is always called inside the component's
// runWithScope (from render()), so the handle auto-disposes with that scope. An
// extra onDispose(() => handle.stop()) would be redundant when scoped and, with
// no active scope, onDispose runs its cleanup immediately — stopping the effect
// the instant it's created. So we rely on sigrea's own scope binding.
export function renderEffect(fn: () => void): WatchHandle {
  return watchEffect(fn, { flush: "sync" });
}

// Attach an event handler via the whitelisted Ark `on*` method. Unknown events
// were already rejected at build time; this guards at runtime too. Cleanup is
// tied to the active Scope.
export function on(element: SafeElement, event: string, handler: EventHandler): void {
  const method = EVENT_METHODS[event];
  if (!method) return;

  const el = element as unknown as Record<string, (h: EventHandler) => EventCleanup>;
  const fn = el[method];
  if (typeof fn !== "function") return;

  const cleanup = fn.call(element, handler);
  if (typeof cleanup === "function") onDispose(cleanup);
}

// Set a raw text node's content, coercing nullish to empty string.
export function setText(node: SafeTextNode, value: unknown): void {
  node.setText(value == null ? "" : String(value));
}

// Append a child node to a parent element.
export function append(parent: SafeElement, child: SafeNode): void {
  parent.appendChild(child);
}

// A single v-if / v-else-if / v-else branch. `condition` is null for v-else.
// `factory` builds and returns the branch's top-level nodes; it closes over the
// generated render's `_ctx` and `gui` lexically.
export type IfBranch = {
  condition: (() => unknown) | null;
  factory: () => Array<SafeNode>;
};

// A deferred root-level v-if. render() cannot mount it — the mount container is
// only known to component.ts — so render returns this marker (carrying its
// already-created anchor) and component.ts binds it via createIf(container, …).
export interface RootIfMarker {
  __deca_rootIf__: true;
  anchor: SafeTextNode;
  branches: Array<IfBranch>;
}

export function rootIf(anchor: SafeTextNode, branches: Array<IfBranch>): RootIfMarker {
  return { __deca_rootIf__: true, anchor, branches };
}

export function isRootIf(node: unknown): node is RootIfMarker {
  return typeof node === "object" && node !== null && (node as RootIfMarker).__deca_rootIf__ === true;
}

// Pick the active branch index: first v-if / v-else-if whose condition is
// truthy, else the v-else (null condition), else -1 (nothing renders).
function pickBranch(branches: Array<IfBranch>): number {
  for (let i = 0; i < branches.length; i++) {
    const condition = branches[i].condition;
    if (condition === null) return i;
    if (condition()) return i;
  }
  return -1;
}

// The one reactive-branch primitive. `parent` receives the branch nodes;
// `anchor` is an already-mounted sibling that positions them via insertBefore.
// Both are handed in explicitly — a node cannot locate its own parent (ark has
// no parentNode), so createIf never reads ambient container state.
//
// Each active branch owns a child Scope parented to the component scope (via the
// scope active at call time). On condition change we dispose the old branch's
// scope (tearing down its interpolation effects + event cleanups) then mount the
// new one. On component unmount, sigrea's createScope(parent) auto-registered
// `parentScope.addCleanup(() => branchScope.dispose())`, so the live branch is
// disposed by the component scope's own teardown — no manual onDispose needed.
export function createIf(parent: SafeElement, anchor: SafeNode, branches: Array<IfBranch>): void {
  const parentScope = getCurrentScope();
  let active: { index: number; scope: Scope; nodes: Array<SafeNode> } | null = null;

  renderEffect(() => {
    const index = pickBranch(branches);
    if (active && active.index === index) return;

    if (active) {
      for (const node of active.nodes) node.remove();
      active.scope.dispose();
      active = null;
    }

    if (index === -1) return;

    const branchScope = createScope(parentScope);
    const nodes = runWithScope(branchScope, () => branches[index].factory());
    for (const node of nodes) parent.insertBefore(node, anchor);
    active = { index, scope: branchScope, nodes };
  });
}

// Wrap the setup() return in an auto-unwrapping context. Reading `_ctx.count`
// returns the underlying value of a sigrea signal (tracked when inside a
// renderEffect); functions and plain values pass through untouched. This gives
// Vue-identical template ergonomics ({{ count }} shows the number) without the
// template needing to write `.value`.
export function createContext(setupResult: Record<string, unknown>): Record<string, unknown> {
  return new Proxy(setupResult, {
    get(target, key: string) {
      const value = Reflect.get(target, key);
      return isSignal(value) ? (value as { value: unknown }).value : value;
    },
  });
}
