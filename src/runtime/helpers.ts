import type { SafeElement, SafeTextNode, EventHandler, EventCleanup } from "ark-of-atrahasis";
import {
  watchEffect,
  signal,
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
// renderEffect); functions and plain values pass through untouched. Writing
// `_ctx.count = v` assigns to the signal's `.value` (so inline handlers like
// `@click="count++"` mutate the signal instead of replacing it with a number);
// writing a non-signal key falls through to a plain set. This gives
// Vue-identical template ergonomics ({{ count }} shows the number, `count++`
// increments it) without the template needing to write `.value`.
export function createContext(setupResult: Record<string, unknown>): Record<string, unknown> {
  return new Proxy(setupResult, {
    get(target, key: string) {
      const value = Reflect.get(target, key);
      return isSignal(value) ? (value as { value: unknown }).value : value;
    },
    set(target, key: string, incoming) {
      const current = Reflect.get(target, key);
      if (isSignal(current)) {
        (current as { value: unknown }).value = incoming;
        return true;
      }
      return Reflect.set(target, key, incoming);
    },
  });
}

// ── v-for ──────────────────────────────────────────────────────────────────
//
// createFor reconciles a reactive keyed list against ark node creation. It is a
// port of @vue/runtime-vapor's apiCreateFor (right-to-left placement with anchor
// resolution) MINUS the prevAnchor linked-list optimisation: going right-to-left
// and tracking the successor row's first node yields the same insert reference
// directly. No LIS, no VDOM. Explicit-tree throughout — every row node comes from
// a whitelisted ark creator emitted by codegen.

// The loop aliases from `v-for="(value, key, index) in source"`. `value` is
// always present; `key`/`index` are null when the template omits them.
export interface ForAliases {
  value: string;
  key: string | null;
  index: string | null;
}

// The codegen-emitted config for one v-for site (see codegen genForConfig).
export interface ForConfig {
  // The outer component context — the row proxy delegates non-alias reads here.
  ctx: Record<string, unknown>;
  // Lazy list getter, read inside the reactive effect so the source tracks.
  source: () => unknown;
  aliases: ForAliases;
  // Builds one row's nodes; receives the per-row proxy as its `_ctx`.
  factory: (rowCtx: Record<string, unknown>) => Array<SafeNode>;
  // The `:key` function `(value, key, index) => keyExpr`, or null when unkeyed.
  key: ((item: unknown, key: unknown, index: unknown) => unknown) | null;
}

type ValueSignal = { value: unknown };

// One rendered row. `scope` owns the row's interpolation effects + event
// cleanups (disposed on removal); the signals feed the row proxy so a reused
// row re-renders in place (write itemSig.value → the row's bindings re-run).
interface Row {
  nodes: Array<SafeNode>;
  scope: Scope;
  key: unknown;
  itemSig: ValueSignal;
  keySig: ValueSignal | null;
  indexSig: ValueSignal | null;
}

// A layered context for one row: alias reads resolve to the row's own signals
// (tracked); everything else delegates to the outer component ctx (which itself
// unwraps signals). This is why the row body prefixer stays unchanged — the
// generated `_ctx.item` routes here to itemSig, `_ctx.count` falls through to the
// component. Only aliases that were actually declared (non-null) intercept.
function rowContext(
  outer: Record<string, unknown>,
  aliases: ForAliases,
  itemSig: ValueSignal,
  keySig: ValueSignal | null,
  indexSig: ValueSignal | null,
): Record<string, unknown> {
  return new Proxy(outer, {
    get(target, key: string) {
      if (key === aliases.value) return itemSig.value;
      if (keySig && key === aliases.key) return keySig.value;
      if (indexSig && key === aliases.index) return indexSig.value;
      return Reflect.get(target, key);
    },
    set(target, key: string, incoming) {
      if (key === aliases.value) { itemSig.value = incoming; return true; }
      if (keySig && key === aliases.key) { keySig.value = incoming; return true; }
      if (indexSig && key === aliases.index) { indexSig.value = incoming; return true; }
      return Reflect.set(target, key, incoming);
    },
  });
}

// Build (but do NOT insert) one row: create its signals, a child scope parented
// to the component scope, and run the factory inside that scope so its effects
// die with the row. `keySig`/`indexSig` exist only when the template declared
// that alias — an undeclared alias can't be referenced, so we skip the signal.
function createRow(
  config: ForConfig,
  parentScope: Scope | undefined,
  item: unknown,
  keyVal: unknown,
  indexVal: unknown,
): Row {
  const itemSig = signal(item) as ValueSignal;
  const keySig = config.aliases.key !== null ? (signal(keyVal) as ValueSignal) : null;
  const indexSig = config.aliases.index !== null ? (signal(indexVal) as ValueSignal) : null;

  const scope = createScope(parentScope);
  const proxy = rowContext(config.ctx, config.aliases, itemSig, keySig, indexSig);
  const nodes = runWithScope(scope, () => config.factory(proxy));

  return { nodes, scope, key: undefined, itemSig, keySig, indexSig };
}

// Reuse a row: write the new values into its signals (only on change). With sync
// flush the row's bindings re-run immediately — no remount, DOM identity kept.
// INVARIANT: `row.key` is left untouched because a row is only ever reused when
// its key already equals the new key (suffix/prefix key-equality or a hit in the
// candidate map). Callers must uphold that — reusing a row under a different key
// would leave `row.key` stale and corrupt the next diff.
function updateRow(row: Row, item: unknown, keyVal: unknown, indexVal: unknown): void {
  if (row.itemSig.value !== item) row.itemSig.value = item;
  if (row.keySig && row.keySig.value !== keyVal) row.keySig.value = keyVal;
  if (row.indexSig && row.indexSig.value !== indexVal) row.indexSig.value = indexVal;
}

// Tear down a removed row: dispose its scope (kills its effects/handlers) then
// detach its nodes from the DOM.
function unmountRow(row: Row): void {
  row.scope.dispose();
  for (const node of row.nodes) node.remove();
}

// Insert (or relocate) a row's nodes before `ref`. insertBefore on an already-
// mounted node moves it — that is our reorder primitive, and it preserves node
// identity (the same node object is relocated, not recreated).
function insertRow(parent: SafeElement, row: Row, ref: SafeNode): void {
  for (const node of row.nodes) parent.insertBefore(node, ref);
}

// Normalise the source to an array. Slice 4 supports array sources (the
// acceptance shape); nullish → empty (tolerates async-loaded lists). Anything
// else fails loud rather than silently rendering nothing.
function normalizeValues(source: unknown): Array<unknown> {
  if (Array.isArray(source)) return source;
  if (source == null) return [];
  throw new Error("v-for source must be an array in this slice.");
}

// The reconciler. `parent` receives the rows; `anchor` is an already-mounted
// trailing marker (raw text node) that positions them — the last row inserts
// before it, and it is the fallback insert reference for the tail. Both are
// handed in explicitly (ark has no parentNode, so we never read ambient state).
export function createFor(parent: SafeElement, anchor: SafeNode, config: ForConfig): void {
  const parentScope = getCurrentScope();
  const getKey = config.key;
  let oldBlocks: Array<Row> = [];
  let mounted = false;

  renderEffect(() => {
    const values = normalizeValues(config.source());
    const newLen = values.length;
    const oldLen = oldBlocks.length;
    const newBlocks: Array<Row> = new Array(newLen);

    // Precompute keys while this effect is still the active subscriber, so a
    // key that reads an item field is tracked as a dep of the list.
    //
    // Duplicate keys would collapse in the keyed diff's `new Map(oldCand)`
    // (later same-key entries overwrite earlier ones), stranding the earlier
    // row: neither reused nor unmounted → a zombie node with a live scope. We
    // fail loud instead, mirroring normalizeValues — a friendly dev-mode
    // warn-and-recover is a later slice. Runs every diff (keys can collide on
    // any update, not just mount), keyed path only (unkeyed has no getKey).
    let newKeys: Array<unknown> | null = null;
    if (getKey) {
      newKeys = new Array(newLen);
      const seen = new Set<unknown>();
      for (let i = 0; i < newLen; i++) {
        const k = getKey(values[i], i, undefined);
        if (seen.has(k)) throw new Error("v-for keys must be unique; duplicate key: " + String(k));
        seen.add(k);
        newKeys[i] = k;
      }
    }

    // A/B: initial mount, or all-new (no old rows) — create each, append at tail.
    if (!mounted || oldLen === 0) {
      mounted = true;
      for (let i = 0; i < newLen; i++) {
        const row = createRow(config, parentScope, values[i], i, undefined);
        if (newKeys) row.key = newKeys[i];
        newBlocks[i] = row;
        insertRow(parent, row, anchor);
      }
      oldBlocks = newBlocks;
      return;
    }

    // C: clear-all — unmount every old row.
    if (newLen === 0) {
      for (let i = 0; i < oldLen; i++) unmountRow(oldBlocks[i]);
      oldBlocks = newBlocks;
      return;
    }

    // D: unkeyed — positional patch. Reuse [0,common), mount the tail, unmount
    // the excess. No key matching, no moves.
    if (!getKey) {
      const common = Math.min(oldLen, newLen);
      for (let i = 0; i < common; i++) {
        const row = (newBlocks[i] = oldBlocks[i]);
        updateRow(row, values[i], i, undefined);
      }
      for (let i = oldLen; i < newLen; i++) {
        const row = createRow(config, parentScope, values[i], i, undefined);
        newBlocks[i] = row;
        insertRow(parent, row, anchor);
      }
      for (let i = newLen; i < oldLen; i++) unmountRow(oldBlocks[i]);
      oldBlocks = newBlocks;
      return;
    }

    // E: keyed diff.
    const keys = newKeys!;
    const commonLen = Math.min(oldLen, newLen);

    // 1. Suffix skip: matching tail keys update in place.
    let endOffset = 0;
    while (endOffset < commonLen) {
      const ni = newLen - endOffset - 1;
      const oi = oldLen - endOffset - 1;
      const oldRow = oldBlocks[oi];
      if (oldRow.key !== keys[ni]) break;
      updateRow(oldRow, values[ni], ni, undefined);
      newBlocks[ni] = oldRow;
      endOffset++;
    }

    const e1 = commonLen - endOffset; // prefix scan boundary
    const e2 = oldLen - endOffset;    // old middle end
    const e3 = newLen - endOffset;    // new middle end

    // 2. Prefix scan [0,e1): same-position same-key updates in place; mismatches
    //    become candidates (old side) and queued work (new side).
    const queued: Array<[number, unknown, unknown]> = []; // [newIndex, item, key]
    const oldCand: Array<[unknown, number]> = [];         // [key, oldIndex]
    for (let i = 0; i < e1; i++) {
      const oldRow = oldBlocks[i];
      if (oldRow.key === keys[i]) {
        updateRow((newBlocks[i] = oldRow), values[i], i, undefined);
      } else {
        queued.push([i, values[i], keys[i]]);
        oldCand.push([oldRow.key, i]);
      }
    }

    // 3. Old middle [e1,e2) → all candidates. New middle [e1,e3) → all queued.
    for (let i = e1; i < e2; i++) oldCand.push([oldBlocks[i].key, i]);
    for (let i = e1; i < e3; i++) queued.push([i, values[i], keys[i]]);

    // 4. Walk queued RIGHT-TO-LEFT. Reuse when the key exists among candidates
    //    (delete so leftovers = removals); else mark a mount. `opers` ends up in
    //    DESCENDING new-index order — exactly the placement order we need.
    const map = new Map(oldCand);
    const opers: Array<{ index: number; row: Row } | { index: number; item: unknown; key: unknown }> = [];
    for (let i = queued.length - 1; i >= 0; i--) {
      const [index, item, key] = queued[i];
      const oldIdx = map.get(key);
      if (oldIdx !== undefined) {
        map.delete(key);
        const row = (newBlocks[index] = oldBlocks[oldIdx]);
        updateRow(row, item, index, undefined);
        opers.push({ index, row });
      } else {
        opers.push({ index, item, key });
      }
    }

    // 5. Removals: whatever keys remain unmatched in the candidate map.
    for (const leftoverIdx of map.values()) unmountRow(oldBlocks[leftoverIdx]);

    // 6. Place. opers is already descending, so when we place index the
    //    successor newBlocks[index+1] is already positioned (higher index, or a
    //    suffix/prefix-matched row that never moved). Its first node is the
    //    insert reference; past the end, the trailing anchor is.
    for (const oper of opers) {
      const index = oper.index;
      const successor = index < newLen - 1 ? newBlocks[index + 1] : null;
      const ref = successor ? successor.nodes[0]! : anchor;
      if ("row" in oper) {
        insertRow(parent, oper.row, ref);
      } else {
        const row = createRow(config, parentScope, oper.item, index, undefined);
        row.key = oper.key;
        newBlocks[index] = row;
        insertRow(parent, row, ref);
      }
    }

    oldBlocks = newBlocks;
  });
}

// A deferred root-level v-for. Like rootIf, render() cannot mount it (only
// component.ts knows the container), so render returns this marker carrying the
// already-created anchor + config, and component.ts binds it via createFor.
export interface RootForMarker {
  __deca_rootFor__: true;
  anchor: SafeTextNode;
  config: ForConfig;
}

export function rootFor(anchor: SafeTextNode, config: ForConfig): RootForMarker {
  return { __deca_rootFor__: true, anchor, config };
}

export function isRootFor(node: unknown): node is RootForMarker {
  return typeof node === "object" && node !== null && (node as RootForMarker).__deca_rootFor__ === true;
}
