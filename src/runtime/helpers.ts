import type { SafeElement, SafeTextNode, SafeDocument, EventHandler, EventCleanup } from "ark-of-atrahasis";
import {
  watchEffect,
  signal,
  isSignal,
  onDispose,
  getCurrentScope,
  createScope,
  runWithScope,
  untracked,
  type WatchHandle,
  type Scope,
} from "../reactivity.ts";
import { EVENT_METHODS } from "./event-methods.ts";
import { getCurrentInstance, runWithInstance, type ComponentInstance } from "./instance.ts";

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

// Mount a `<style>` block's CSS. ark's createStyle() appends a fresh <style> to
// document.head; setCSS writes its textContent (ark's own allowlist drops any
// `url(...)` rule). Insertion is INSTANCE-LEVEL: mountStyle is emitted at the top
// of render(), so it runs once per component instance / per v-for row, and
// registers onDispose(remove) so the <style> is torn down when the owning scope
// disposes (render() always runs inside runWithScope). N live instances therefore
// insert the CSS N times — an accepted tradeoff for this slice (no dedup).
export function mountStyle(gui: SafeDocument, css: string): void {
  const sheet = gui.createStyle();
  sheet.setCSS(css);
  onDispose(() => sheet.remove());
}

// Inline `style` binding (both static `style="color: red"` and dynamic
// `:style="{ color }"`). ark elements have NO cssText sink — `setCSS` lives on
// SafeStyleSheet (the <style> element), not on a SafeElement. Instead every
// element exposes `element.style`, a per-property allowlist proxy
// (Record<string,string>): assigning `style[prop] = val` sets that one property
// if it is whitelisted (and not a url()), else silently no-ops. So we normalise
// the bound value to individual property writes rather than one string set.
//
// Vue's :style value shapes are supported: a CSS string, a property object, an
// array of either (merged left-to-right), or nullish (no-op). An unknown or
// blocked property is dropped by ark's proxy — whitelist-by-construction, same
// posture as an unmapped attribute.
//
// NOTE: a re-run (dynamic binding) writes the new value's properties but does NOT
// clear properties that were present last run and absent now — so a binding whose
// KEY SET changes across renders (`cond ? {color} : {fontSize}`) can leave a stale
// property. Values changing under a fixed key set update correctly. Fuller
// prev/next diffing is deferred.
export function setStyle(element: SafeElement, value: unknown): void {
  applyStyle(element.style, value);
}

function applyStyle(style: Record<string, string>, value: unknown): void {
  if (value == null) return;
  if (typeof value === "string") {
    for (const decl of value.split(";")) {
      const colon = decl.indexOf(":");
      if (colon === -1) continue;
      const prop = decl.slice(0, colon).trim();
      const val = decl.slice(colon + 1).trim();
      if (prop) setStyleProp(style, prop, val);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) applyStyle(style, item);
    return;
  }
  if (typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      const v = (value as Record<string, unknown>)[key];
      if (v != null) setStyleProp(style, key, String(v));
    }
  }
}

// Assign one property through ark's allowlist proxy. A disallowed / url() prop
// makes the proxy's set-trap return false; under an ESM strict-mode module a
// plain `style[prop] = v` on a falsy trap THROWS — so route via Reflect.set,
// which surfaces the rejection as a return value we can simply ignore. This is
// the "unknown prop is dropped, not fatal" posture (mirrors an unmapped attr).
//
// The name is camelised first: ark writes `realEl.style[prop] = v` by BRACKET
// access, and a real CSSStyleDeclaration only honours bracket assignment for the
// camelCase spelling (`backgroundColor`), silently ignoring kebab
// (`background-color`). Kebab comes from string styles (`"background-color: …"`);
// object styles already use camel. ark's allowlist carries both spellings, so
// the camelised name still passes its check.
function setStyleProp(style: Record<string, string>, prop: string, value: string): void {
  Reflect.set(style, camelize(prop), value);
}

// `background-color` -> `backgroundColor`. A leading `-` (custom property or
// vendor prefix like `--foo`) is left as-is — it is not in ark's allowlist and
// will be dropped, so there is nothing to normalise.
function camelize(prop: string): string {
  if (prop.startsWith("-")) return prop;
  return prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

// `:class` value normalisation — Vue's `normalizeClass`, verbatim algorithm.
// Flattens the three author shapes into ONE space-joined class string that
// codegen hands to ark's `setClass` (which REPLACES the whole `class` attr, so a
// reactive re-run recomputes cleanly — no stale-class diffing needed, unlike
// :style):
//   - string   → passed through as-is (`"a b"`).
//   - array    → each element normalised recursively, then space-joined
//                (`["a", { b: x }]` — mixed shapes allowed, Vue-identical).
//   - object   → every key whose value is TRUTHY, space-joined
//                (`{ bold: isActive, big: false }` → `"bold"` when isActive).
//   - nullish / other → "" (an absent or non-stringable class contributes nothing).
//
// The static+dynamic MERGE (`class="btn" :class="{ active }"`) needs no special
// case: codegen emits `normalizeClass(["btn", { active: _ctx.active }])`, and the
// array branch here concatenates the static base with the dynamic result — so the
// base class is always present, exactly like Vue.
export function normalizeClass(value: unknown): string {
  if (typeof value === "string") return value;

  if (Array.isArray(value)) {
    let out = "";
    for (const item of value) {
      const normalized = normalizeClass(item);
      if (normalized) out += (out ? " " : "") + normalized;
    }
    return out;
  }

  if (value != null && typeof value === "object") {
    let out = "";
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if ((value as Record<string, unknown>)[key]) out += (out ? " " : "") + key;
    }
    return out;
  }

  return "";
}

// v-model `.number` coercion. Mirrors Vue's `looseToNumber`: parse the string;
// if the parse yields NaN (non-numeric input like "" or "abc"), return the
// ORIGINAL string untouched rather than writing NaN into the model. So a
// half-typed field stays a string until it is a valid number, matching Vue.
export function toModelNumber(raw: string): string | number {
  const n = parseFloat(raw);
  return isNaN(n) ? raw : n;
}

// v-model array-checkbox READ: is `value` currently a member of the model array?
// The model may be nullish before it is populated (tolerated → not checked); a
// non-array is a template author error (a value-carrying checkbox binds an array
// in Vue), so we fail loud rather than silently mis-rendering.
export function modelArrayHas(model: unknown, value: string): boolean {
  if (model == null) return false;
  if (!Array.isArray(model)) {
    throw new Error("v-model on a checkbox with a `value` expects an array model.");
  }
  return model.includes(value);
}

// v-model array-checkbox WRITE: return a NEW array with `value` added (checked)
// or removed (unchecked). A fresh reference is required — the model is a signal,
// and assigning the same mutated array back would not trip the set-trap's change
// detection. Order is preserved; adding is idempotent (no duplicates).
export function modelArrayToggle(model: unknown, value: string, checked: boolean): Array<unknown> {
  const base = Array.isArray(model) ? model : [];
  if (checked) {
    return base.includes(value) ? base.slice() : [...base, value];
  }
  return base.filter((v) => v !== value);
}

// Append a child node to a parent element.
export function append(parent: SafeElement, child: SafeNode): void {
  parent.appendChild(child);
}

// A slot factory: given the outlet's parent element, build the slot's nodes and
// append each into it. Both a parent-supplied default slot (codegen's `{ default:
// (_parent) => {…} }`) and a `<slot>`'s own fallback share this shape, so mountSlot
// treats them uniformly — it just picks which one to run.
export type SlotFn = (parent: SafeElement) => void;
export type Slots = Record<string, SlotFn>;

// Render a `<slot>` outlet. If the parent supplied a default slot, run it (it was
// wrapped by createComponent to execute under the PARENT's scope + instance, so
// its effects and inject() resolve against the parent that authored the content).
// Otherwise run the outlet's own `fallback` (child-authored, so it runs in the
// child scope as-is). Either way the factory appends straight into `parent` — the
// outlet's element const — so the slot expands to 0..N real children in place.
export function mountSlot(parent: SafeElement, slots: Slots | undefined, fallback: SlotFn): void {
  const provided = slots && slots.default;
  if (provided) {
    provided(parent);
  } else {
    fallback(parent);
  }
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
  // Capture the owning instance NOW (createIf runs during the component's render,
  // so currentInstance is the owner). The branch factory runs REACTIVELY later,
  // outside the mount bracket — a createComponent inside the branch must re-see
  // this instance to parent onto it and resolve inject(). Mirrors parentScope.
  const parentInstance = getCurrentInstance();
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
    const nodes = runWithScope(branchScope, () =>
      runWithInstance(parentInstance, () => branches[index].factory()),
    );
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
//
// `props` (slice 6) is a SECOND layer, resolved UNDER setup state: a template id
// the setup return does not own falls through to the props proxy. compileScript
// returns the props *bag* (`{ props, x, … }`) but NOT the individual prop names,
// so `{{ label }}` -> `_ctx.label` would read undefined without this layer.
// Setup state wins on collision (own key), so a same-named local shadows a prop —
// matching Vue. Props default to an empty object, so the root createApp path
// (no props) is unchanged.
export function createContext(
  setupResult: Record<string, unknown>,
  props: Record<string, unknown> = {},
): Record<string, unknown> {
  return new Proxy(setupResult, {
    get(target, key: string) {
      const value = Reflect.get(target, key);
      // Own-and-defined setup state wins; only a genuine miss falls to props.
      // (`value !== undefined` short-circuits the common case; the hasOwnProperty
      // check keeps an explicitly-`undefined` own key from leaking to props.)
      if (value !== undefined || Object.prototype.hasOwnProperty.call(target, key)) {
        return isSignal(value) ? (value as { value: unknown }).value : value;
      }
      return Reflect.get(props, key);
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

// Wrap the parent's per-prop getters into the object the child's setup receives
// (`const props = __props`) and that createContext falls through to. Each prop is
// a getter emitted by codegen (`{ count: () => _ctx.x }`): reading `props.count`
// invokes it, so a read inside the child's renderEffect tracks the PARENT signal
// the getter closes over — that is what makes props reactive with no extra
// machinery. A key with no getter reads undefined (Vue's absent-prop semantics).
export function createProps(getters: Record<string, () => unknown>): Record<string, unknown> {
  return new Proxy(getters, {
    get(target, key: string) {
      // Own keys only. Reflect.get would walk the prototype, so `props.valueOf`
      // etc. would find an Object.prototype method — a function — and the branch
      // below would CALL it, returning junk (`"[object Undefined]"`) or throwing
      // (valueOf runs with the wrong `this`). A key with no own getter is simply
      // an absent prop → undefined (Vue's semantics).
      if (!Object.prototype.hasOwnProperty.call(target, key)) return undefined;
      const getter = Reflect.get(target, key);
      return typeof getter === "function" ? getter() : undefined;
    },
    // Props are one-way (parent owns them). Writing `props.x = v` would clobber
    // the getter, and every later read would then hit the non-function branch
    // above and silently return undefined. Fail loud instead of poisoning the
    // prop — Vue makes props read-only for the same reason.
    set(_target, key: string) {
      throw new Error(
        `Cannot assign to prop "${key}": props are read-only (they belong to the parent).`,
      );
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

// The loop aliases from `v-for="(value, key, index) in source"`. `key`/`index`
// are null when the template omits them. `value` is either a plain identifier
// name (`"item"`) or a destructuring descriptor (`{ destructure: [{ local, key }] }`)
// lowered from `{ name, age }` / `[a, b]` — each `local` is a row-scoped name that
// reads the item's `key` property/index.
export interface ForDestructure {
  destructure: Array<{ local: string; key: string | number }>;
}

export interface ForAliases {
  value: string | ForDestructure;
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
//
// A destructured value alias (`{ name, age } in users`) has no single item name:
// each destructured `local` reads a property/index off the current item instead.
// Reading `itemSig.value` inside the trap keeps the row reactive — a reused row
// writes its itemSig and every destructured read re-runs. Writing a destructured
// local is rejected (Vue's destructured aliases are read-only bindings).
function rowContext(
  outer: Record<string, unknown>,
  aliases: ForAliases,
  itemSig: ValueSignal,
  keySig: ValueSignal | null,
  indexSig: ValueSignal | null,
): Record<string, unknown> {
  const valueAlias = aliases.value;
  const destructure = typeof valueAlias === "object" ? valueAlias.destructure : null;
  // Map each destructured local name → the item key it reads, for O(1) lookup.
  const localToKey = destructure
    ? new Map(destructure.map((e) => [e.local, e.key] as const))
    : null;

  return new Proxy(outer, {
    get(target, key: string) {
      if (localToKey) {
        if (localToKey.has(key)) {
          const item = itemSig.value;
          return item == null ? undefined : (item as Record<string | number, unknown>)[localToKey.get(key)!];
        }
      } else if (key === valueAlias) {
        return itemSig.value;
      }
      if (keySig && key === aliases.key) return keySig.value;
      if (indexSig && key === aliases.index) return indexSig.value;
      return Reflect.get(target, key);
    },
    set(target, key: string, incoming) {
      if (localToKey) {
        if (localToKey.has(key)) {
          throw new Error(
            `Cannot assign to destructured v-for alias "${key}" — destructured row bindings are read-only.`,
          );
        }
      } else if (key === valueAlias) {
        itemSig.value = incoming;
        return true;
      }
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
  parentInstance: ComponentInstance | null,
  item: unknown,
  keyVal: unknown,
  indexVal: unknown,
): Row {
  const itemSig = signal(item) as ValueSignal;
  const keySig = config.aliases.key !== null ? (signal(keyVal) as ValueSignal) : null;
  const indexSig = config.aliases.index !== null ? (signal(indexVal) as ValueSignal) : null;

  const scope = createScope(parentScope);
  const proxy = rowContext(config.ctx, config.aliases, itemSig, keySig, indexSig);
  // Re-establish the owning instance around the factory (same reason as createIf):
  // a createComponent inside a v-for row runs reactively, outside the mount
  // bracket, and must parent onto the list's owning instance for inject() to work.
  const nodes = runWithScope(scope, () =>
    runWithInstance(parentInstance, () => config.factory(proxy)),
  );

  return { nodes, scope, key: undefined, itemSig, keySig, indexSig };
}

// Reuse a row: write the new values into its signals (only on change). With sync
// flush the row's bindings re-run immediately — no remount, DOM identity kept.
//
// Runs UNTRACKED: this executes inside the list's own renderEffect, so a plain
// read of `row.itemSig.value` in the change-guard would subscribe the LIST effect
// to every row's item signal (a spurious self-dep), and the subsequent write would
// then synchronously re-enter the list effect mid-reconcile via sigrea's unbatched
// sync flush — reassigning `oldBlocks` under the running diff and stranding its
// unmount loop on `undefined`. Severing tracking here keeps the list effect's deps
// to exactly {source, keys}; the write still flushes the ROW's own bindings (their
// scopes subscribed them), just not the list. See createFor.
// INVARIANT: `row.key` is left untouched because a row is only ever reused when
// its key already equals the new key (suffix/prefix key-equality or a hit in the
// candidate map). Callers must uphold that — reusing a row under a different key
// would leave `row.key` stale and corrupt the next diff.
function updateRow(row: Row, item: unknown, keyVal: unknown, indexVal: unknown): void {
  untracked(() => {
    if (row.itemSig.value !== item) row.itemSig.value = item;
    if (row.keySig && row.keySig.value !== keyVal) row.keySig.value = keyVal;
    if (row.indexSig && row.indexSig.value !== indexVal) row.indexSig.value = indexVal;
  });
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
  const parentInstance = getCurrentInstance();
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
        const row = createRow(config, parentScope, parentInstance, values[i], i, undefined);
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
        const row = createRow(config, parentScope, parentInstance, values[i], i, undefined);
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
        const row = createRow(config, parentScope, parentInstance, oper.item, index, undefined);
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
