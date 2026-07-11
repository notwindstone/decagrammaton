// Component-instance concept + provide/inject (slice 6.5).
//
// This is a SEPARATE concern from the sigrea Scope: a Scope owns effect/cleanup
// disposal, an instance owns provide storage and the ancestor lineage. They are
// deliberately not conflated (Scope has no `provides`; the instance has no
// effects). This file imports nothing from component.ts / helpers.ts, so it can
// be the shared owner of `currentInstance` with no import cycle — component.ts
// imports the mount helpers from here, index.ts re-exports provide/inject.

// The minimal instance: just enough for provide/inject. `parent` drives the
// copy-on-write detection; `provides` is the injection store walked by inject().
export interface ComponentInstance {
  parent: ComponentInstance | null;
  provides: Record<string | symbol, unknown>;
}

// The ambient instance — Vue's model. Maintained by the two mount sites
// (createApp.mount, createComponent), which set it before setup() and restore it
// in a finally. It is the instance analog of sigrea's getCurrentScope().
let currentInstance: ComponentInstance | null = null;

export function getCurrentInstance(): ComponentInstance | null {
  return currentInstance;
}

export function setCurrentInstance(instance: ComponentInstance | null): void {
  currentInstance = instance;
}

// Create an instance seeded from its parent per Vue's copy-on-first-write rule:
// `provides` starts as a SHARED reference to the parent's provides (root gets a
// fresh null-prototype object). No allocation happens until this instance calls
// provide() — a component that only injects never copies. The null prototype
// keeps Object.prototype keys (`toString`, `constructor`, …) from leaking into
// injection lookups.
export function createInstance(parent: ComponentInstance | null): ComponentInstance {
  return {
    parent,
    provides: parent ? parent.provides : Object.create(null),
  };
}

// provide(key, value) — store a value on the current instance for descendants.
// Copy-on-first-write: while this instance's `provides` is still the shared
// parent reference, replace it with `Object.create(parentProvides)` before the
// first write, so a child's provide never mutates the parent's object while
// injection stays an O(1) prototype-chain walk. Keys are used directly (string
// or symbol) — symbols let two sandboxed plugins avoid colliding on a shared
// string key. Setup-only: throws loud if called outside a mount bracket.
export function provide(key: string | symbol, value: unknown): void {
  if (currentInstance === null) {
    throw new Error("provide() can only be called synchronously inside setup().");
  }
  let provides = currentInstance.provides;
  const parentProvides = currentInstance.parent && currentInstance.parent.provides;
  if (parentProvides === provides) {
    provides = currentInstance.provides = Object.create(parentProvides);
  }
  provides[key] = value;
}

// inject(key, default?) — resolve a provided value up the ancestor chain. The
// prototype chain does the walk: `key in provides` is true if any ancestor
// provided it. On a miss, return the default if one was passed (Vue's
// arguments.length check, so `inject(k, undefined)` still returns undefined),
// else undefined. Values pass through untouched — to share reactive state, a
// developer provides a signal and both sides read the SAME signal object.
// Setup-only: throws loud if called outside a mount bracket.
export function inject(key: string | symbol, defaultValue?: unknown): unknown {
  if (currentInstance === null) {
    throw new Error("inject() can only be called synchronously inside setup().");
  }
  const provides = currentInstance.provides;
  if (key in provides) {
    return provides[key];
  }
  if (arguments.length > 1) {
    return defaultValue;
  }
  return undefined;
}
