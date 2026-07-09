import type { SafeElement, SafeTextNode, EventHandler, EventCleanup } from "ark-of-atrahasis";
import { watchEffect, isSignal, onDispose, type WatchHandle } from "../reactivity.ts";
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
