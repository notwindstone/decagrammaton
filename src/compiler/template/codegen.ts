import { DecaCompileError } from "../errors.ts";
import { TAG_CREATORS, FORMATTING_TAGS, EVENT_METHODS, ATTR_SETTERS } from "../tables.ts";
import { rewriteExpression, rewriteHandler, rewriteModelTarget, forValueLocals } from "./expression.ts";
import type { IRNode, IRElement, IRText, IRInterpolation, IRIf, IRFor, IRComponent, IRModel } from "./ir.ts";

// IR -> source string of a `render(_ctx, gui)` function.
//
// The explicit-tree idiom (rewrite plan §2.3): every node is created via a
// whitelisted Ark creator and held in its own `const`. We build top-down —
// create parent, create each child, append child to parent — so there is NEVER
// any `_child` / `_next` DOM traversal and NEVER a `_template("<html>")` string.
// An unknown tag/event has no table entry and throws here at build time.
//
// v-if (slice 3): a reactive branch is lowered to a `createIf` call plus an
// invisible anchor (an empty raw-text node — ark has no comment/marker creator,
// and createAnchor() is a real <a> hyperlink, not a marker). A *nested* v-if
// appends its anchor to the in-scope parent const and calls
// `createIf(parent, anchor, branches)`. A *root-level* v-if has no parent in
// render() (only component.ts knows the mount container), so it emits a
// `rootIf(anchor, branches)` marker among the roots; component.ts binds it.

interface Ctx {
  lines: Array<string>;
  counter: number;
}

export function generate(nodes: Array<IRNode>, styles: Array<string> = []): string {
  const ctx: Ctx = { lines: [], counter: 0 };
  const roots: Array<string> = [];

  // <style> blocks mount first: emit one mountStyle(gui, css) per block at the top
  // of the body, before any node is created. Instance-level insertion + scope-bound
  // teardown live in the runtime helper; here we only pin an escaped string literal.
  for (const css of styles) {
    ctx.lines.push(`mountStyle(gui, ${JSON.stringify(css)});`);
  }

  for (const node of nodes) {
    if (node.kind === "if") {
      roots.push(genRootIf(node, ctx));
      continue;
    }
    if (node.kind === "for") {
      roots.push(genRootFor(node, ctx));
      continue;
    }
    roots.push(genNode(node, ctx));
  }

  const body = ctx.lines.map((l) => `  ${l}`).join("\n");
  return `export function render(_ctx, gui) {\n${body}\n  return [${roots.join(", ")}];\n}`;
}

function genNode(node: IRNode, ctx: Ctx): string {
  switch (node.kind) {
    case "element":
      return genElement(node, ctx);
    case "component":
      return genComponent(node, ctx);
    case "text":
      return genText(node, ctx);
    case "interpolation":
      return genInterpolation(node, ctx);
    case "if":
      // v-if is never a single appendable node; callers special-case it before
      // reaching genNode. Reaching here means a bug in the caller.
      throw new DecaCompileError("Internal: v-if reached genNode (should be handled by caller).");
    case "for":
      // Same as v-if: v-for is lowered by genRootFor / genNestedFor, never here.
      throw new DecaCompileError("Internal: v-for reached genNode (should be handled by caller).");
  }
}

function genElement(node: IRElement, ctx: Ctx): string {
  const name = `n${ctx.counter++}`;
  ctx.lines.push(`const ${name} = ${resolveCreator(node.tag)};`);

  for (const event of node.events) {
    const method = EVENT_METHODS[event.name];
    if (!method) {
      throw new DecaCompileError(`Unknown event "@${event.name}" — no whitelisted Ark handler.`);
    }
    ctx.lines.push(`on(${name}, ${JSON.stringify(event.name)}, ${rewriteHandler(event.handler)});`);
  }

  for (const attr of node.attrs) {
    genAttr(attr, name, node.tag, ctx);
  }

  for (const child of node.children) {
    if (child.kind === "if") {
      genNestedIf(child, name, ctx);
      continue;
    }
    if (child.kind === "for") {
      genNestedFor(child, name, ctx);
      continue;
    }
    const childName = genNode(child, ctx);
    ctx.lines.push(`append(${name}, ${childName});`);
  }

  // v-model is emitted AFTER children on purpose: a <select>'s value can only be
  // set once its <option>s exist in the DOM (the browser silently drops a value
  // with no matching option, defaulting to the first). Inputs/textarea have no
  // such children, so the position is harmless for them.
  if (node.model) {
    genModel(node.model, name, ctx);
  }

  return name;
}

// Emit one attribute setter on `target` (the element const). Whitelist by
// construction: the attr name is resolved to a named ark setter, and an attr
// with no mapping THROWS here at build time — there is no generic setAttribute
// (§1 security invariant), so an unmapped attr has nothing to call.
//
// `data-*` / `aria-*` are the two-arg exception: `setData(key, value)` /
// `setAria(key, value)`. Everything else is one-arg. Static attrs emit a single
// call with a string literal; dynamic attrs (`:attr="expr"`) wrap the call in a
// renderEffect so the setter re-runs when its deps change — the expression is
// prefixed by rewriteExpression, which also routes v-for row locals correctly.
function genAttr(
  attr: IRElement["attrs"][number],
  target: string,
  tag: string,
  ctx: Ctx,
): void {
  // baseParse preserves author casing; HTML attrs are case-insensitive, so
  // normalize to lowercase for the setter lookup and the prefix split.
  const lower = attr.name.toLowerCase();

  // Two-arg data-/aria- setters. The remainder after the prefix is the key
  // passed as the first argument (e.g. `data-id` -> setData("id", …)).
  if (lower.startsWith("data-") || lower.startsWith("aria-")) {
    const method = lower.startsWith("data-") ? "setData" : "setAria";
    const key = attr.name.slice(5); // preserve author casing of the key itself
    const value = attr.dynamic
      ? rewriteExpression(attr.value)
      : JSON.stringify(attr.value);
    if (attr.dynamic) {
      ctx.lines.push(
        `renderEffect(() => ${target}.${method}(${JSON.stringify(key)}, ${value}));`,
      );
    } else {
      ctx.lines.push(`${target}.${method}(${JSON.stringify(key)}, ${value});`);
    }
    return;
  }

  // Inline `style`: NOT a one-arg element setter (ark elements have no cssText
  // sink — `setCSS` is a <style>-element method). It routes to the setStyle
  // runtime helper, which fans the value out over `element.style`'s per-property
  // allowlist proxy. Static → one call with the CSS-string literal; dynamic →
  // wrapped in a renderEffect like any other bind (the expr may be an object).
  if (lower === "style") {
    if (attr.dynamic) {
      ctx.lines.push(`renderEffect(() => setStyle(${target}, ${rewriteExpression(attr.value)}));`);
    } else {
      ctx.lines.push(`setStyle(${target}, ${JSON.stringify(attr.value)});`);
    }
    return;
  }

  const setter = ATTR_SETTERS[lower];
  if (!setter) {
    throw new DecaCompileError(
      `Unknown attribute "${attr.name}" on <${tag}> — no whitelisted Ark setter. ` +
        `Add it to ATTR_SETTERS only if ark-of-atrahasis exposes a safe setter.`,
    );
  }

  if (attr.dynamic) {
    ctx.lines.push(
      `renderEffect(() => ${target}.${setter}(${rewriteExpression(attr.value)}));`,
    );
  } else {
    ctx.lines.push(`${target}.${setter}(${JSON.stringify(attr.value)});`);
  }
}

// Emit a v-model two-way binding on `target` (the element const). Two directions:
//
//   READ  (state → DOM): a renderEffect that sets the DOM property from the model
//         expression, so an external write to the signal repaints the field.
//   WRITE (DOM → state): an `on()` event handler that reads the element back
//         (`getValue`/`getChecked` — NOT `$event.target`, which ark's frozen
//         SafeEvent limits to `{ id, value }`, no `.checked`) and assigns through
//         the model lvalue. The assignment routes through createContext's set-trap
//         to the underlying signal (identical to how `@click="count++"` writes).
//
// The lvalue is rewriteModelTarget'd (asserted assignable + prefixed); the read
// side is a normal rewriteExpression so it tracks the signal inside the effect.
function genModel(model: IRModel, target: string, ctx: Ctx): void {
  const lvalue = rewriteModelTarget(model.expression);
  const read = rewriteExpression(model.expression);

  if (model.kind === "checkbox") {
    // Boolean model ↔ checked. `change` fires on toggle; `!!` coerces the model
    // to a definite boolean for the setter.
    ctx.lines.push(`renderEffect(() => ${target}.setChecked(!!${read}));`);
    ctx.lines.push(`on(${target}, "change", () => { ${lvalue} = ${target}.getChecked(); });`);
    return;
  }

  if (model.kind === "checkbox-array") {
    // Vue's array binding: the box is checked when its value is a member of the
    // model array; toggling it produces a NEW array (add on check, remove on
    // uncheck) assigned back through the set-trap — a fresh array reference so the
    // signal actually fires (in-place mutation wouldn't). modelArrayHas /
    // modelArrayToggle are runtime helpers; the value is a static JSON literal.
    const value = JSON.stringify(model.staticValue);
    ctx.lines.push(`renderEffect(() => ${target}.setChecked(modelArrayHas(${read}, ${value})));`);
    ctx.lines.push(
      `on(${target}, "change", () => { ${lvalue} = modelArrayToggle(${read}, ${value}, ${target}.getChecked()); });`,
    );
    return;
  }

  if (model.kind === "radio") {
    // The element is checked when the model equals THIS radio's value; picking
    // it writes that value back. staticValue is a static string (JSON literal).
    const value = JSON.stringify(model.staticValue);
    ctx.lines.push(`renderEffect(() => ${target}.setChecked(${read} === ${value}));`);
    ctx.lines.push(
      `on(${target}, "change", () => { if (${target}.getChecked()) ${lvalue} = ${value}; });`,
    );
    return;
  }

  // text-like input / textarea / select. Coerce the model to a string for the
  // setter (matches Vue's `value == null ? "" : String(value)`).
  ctx.lines.push(`renderEffect(() => ${target}.setValue(String(${read} ?? "")));`);

  // Read the raw string back, then apply modifiers in Vue's order: trim first,
  // then numeric coercion (toModelNumber leaves an unparseable string as-is).
  let readback = `${target}.getValue()`;
  if (model.trim) readback = `${readback}.trim()`;
  if (model.number) readback = `toModelNumber(${readback})`;

  // A <select> commits on `change` (there is no per-keystroke `input`); a
  // text input/textarea commits on `input`, or on `change` under `.lazy`.
  const event = model.kind === "select" || model.lazy ? "change" : "input";
  ctx.lines.push(`on(${target}, ${JSON.stringify(event)}, () => { ${lvalue} = ${readback}; });`);
}

// render root. component.ts appends the anchor to the container and binds
// createIf there (the only site that knows the container).
function genRootIf(node: IRIf, ctx: Ctx): string {
  const anchor = `n${ctx.counter++}`;
  ctx.lines.push(`const ${anchor} = gui.createRawText();`);
  return `rootIf(${anchor}, ${genBranches(node, ctx)})`;
}

// Nested v-if: the parent element const is in scope, so append the anchor and
// wire createIf directly.
function genNestedIf(node: IRIf, parent: string, ctx: Ctx): void {
  const anchor = `n${ctx.counter++}`;
  ctx.lines.push(`const ${anchor} = gui.createRawText();`);
  ctx.lines.push(`append(${parent}, ${anchor});`);
  ctx.lines.push(`createIf(${parent}, ${anchor}, ${genBranches(node, ctx)});`);
}

// Root-level v-for: no parent element in render() (only component.ts knows the
// container), so emit the anchor and return a `rootFor(...)` marker among the
// roots — the mirror of genRootIf.
function genRootFor(node: IRFor, ctx: Ctx): string {
  const anchor = `n${ctx.counter++}`;
  ctx.lines.push(`const ${anchor} = gui.createRawText();`);
  return `rootFor(${anchor}, ${genForConfig(node, ctx)})`;
}

// Nested v-for: append the anchor to the in-scope parent const and wire
// createFor directly (mirror of genNestedIf).
function genNestedFor(node: IRFor, parent: string, ctx: Ctx): void {
  const anchor = `n${ctx.counter++}`;
  ctx.lines.push(`const ${anchor} = gui.createRawText();`);
  ctx.lines.push(`append(${parent}, ${anchor});`);
  ctx.lines.push(`createFor(${parent}, ${anchor}, ${genForConfig(node, ctx)});`);
}

// The createFor config object. Both root and nested sites emit the same config;
// only the leading `(parent, anchor, …)` differs (marker vs direct call).
//
//   {
//     ctx: _ctx,                                  // outer ctx, for the row proxy
//     source: () => _ctx.items,                   // list getter (reads outer ctx)
//     aliases: { value: "item", key: "i", index: null },
//     factory: (_ctx) => { …row nodes…; return [root] }, // _ctx = per-row proxy
//     key: (item, i) => item.id,                  // key fn, or null when unkeyed
//   }
//
// The factory's `_ctx` param SHADOWS render's outer `_ctx`: the reconciler passes
// a per-row proxy that resolves the loop aliases to the row's signals and
// delegates everything else to the outer ctx (`ctx` above). So the row-body
// prefixer needs no change — `{{ item.title }}` still emits `_ctx.item.title`
// and routes correctly, while `{{ count }}` routes to the outer ctx.
function genForConfig(node: IRFor, ctx: Ctx): string {
  const source = `() => ${rewriteExpression(node.source)}`;

  const aliases =
    `{ value: ${genValueBinding(node.valueBinding)}, ` +
    `key: ${node.keyAlias === null ? "null" : JSON.stringify(node.keyAlias)}, ` +
    `index: ${node.indexAlias === null ? "null" : JSON.stringify(node.indexAlias)} }`;

  const factory = genRowFactory(node.children, ctx);
  const keyFn = genKeyFn(node);

  return (
    `{ ctx: _ctx, source: ${source}, aliases: ${aliases}, ` +
    `factory: ${factory}, key: ${keyFn} }`
  );
}

// The `value` alias descriptor handed to the runtime row proxy. A plain
// identifier stays a string (`"item"`) — the proxy exposes that one name. A
// destructuring pattern becomes `{ destructure: [{ local, key }, …] }` so the
// proxy exposes each local as a read of the matching item property/index
// (`{ name, age }` → name reads item.name; `[a, b]` → a reads item[0]).
function genValueBinding(binding: IRFor["valueBinding"]): string {
  if (binding.kind === "identifier") return JSON.stringify(binding.name);
  const entries = binding.entries
    .map((e) => `{ local: ${JSON.stringify(e.local)}, key: ${JSON.stringify(e.key)} }`)
    .join(", ");
  return `{ destructure: [${entries}] }`;
}

// A row factory builds one row's nodes with its own private line buffer (same
// swapped-buffer trick as genBranchFactory). A row is a single element this
// slice — matching the v-if branch-root rule — so bare text / nested for at the
// row top level is a transform bug; fail loud.
function genRowFactory(children: Array<IRNode>, ctx: Ctx): string {
  const saved = ctx.lines;
  const buffer: Array<string> = [];
  ctx.lines = buffer;

  const roots: Array<string> = [];
  for (const child of children) {
    if (child.kind !== "element" && child.kind !== "component") {
      throw new DecaCompileError("Internal: v-for row root must be a single element or component.");
    }
    roots.push(genNode(child, ctx));
  }

  ctx.lines = saved;
  const body = buffer.map((l) => `    ${l}`).join("\n");
  return `(_ctx) => {\n${body}\n    return [${roots.join(", ")}];\n  }`;
}

// The `:key` function: `(value, key, index) => keyExpr`. Its params are real row
// values (called during the diff, not tracked), so the aliases are seeded as
// locals and stay bare — `item.id` becomes `item.id`, NOT `_ctx.item.id`. Null
// when the list is unkeyed (positional reconcile).
//
// The value param is the raw alias TEXT (`item` or a pattern like `{ name }`), so
// a destructured key (`({ id }) => id`) binds its locals via native JS
// destructuring in the param list; every bound local is seeded so it stays bare.
function genKeyFn(node: IRFor): string {
  if (node.keyExpr === null) return "null";

  const params: Array<string> = [node.valueAlias];
  const locals = new Set<string>(forValueLocals(node.valueBinding));
  if (node.keyAlias !== null) { params.push(node.keyAlias); locals.add(node.keyAlias); }
  if (node.indexAlias !== null) { params.push(node.indexAlias); locals.add(node.indexAlias); }

  return `(${params.join(", ")}) => ${rewriteExpression(node.keyExpr, locals)}`;
}

// Lower each branch into an `{ condition, factory }` IfBranch literal. The
// condition is a lazy getter so createIf reads it inside a tracked effect; the
// factory is a lazy closure that builds the branch's nodes on mount, closing
// over _ctx and gui lexically.
function genBranches(node: IRIf, ctx: Ctx): string {
  const parts = node.branches.map((branch) => {
    const condition =
      branch.condition === null ? "null" : `() => ${rewriteExpression(branch.condition)}`;
    return `{ condition: ${condition}, factory: ${genBranchFactory(branch.children, ctx)} }`;
  });
  return `[${parts.join(", ")}]`;
}

// A branch factory is its own function body with a private line buffer. Node
// names keep incrementing the shared counter so every const across the module
// is unique. A branch root is always a single element (v-if lives on an
// element), so bare text/if at branch top-level is a transform bug — fail loud.
function genBranchFactory(children: Array<IRNode>, ctx: Ctx): string {
  const saved = ctx.lines;
  const buffer: Array<string> = [];
  ctx.lines = buffer;

  const roots: Array<string> = [];
  for (const child of children) {
    if (child.kind !== "element" && child.kind !== "component") {
      throw new DecaCompileError("Internal: v-if branch root must be a single element or component.");
    }
    roots.push(genNode(child, ctx));
  }

  ctx.lines = saved;
  const body = buffer.map((l) => `    ${l}`).join("\n");
  return `() => {\n${body}\n    return [${roots.join(", ")}];\n  }`;
}

// Resolve a component tag to a runtime `createComponent` call. Unlike an
// element, a component has NO build-time ark creator — it is resolved at runtime
// via `_ctx[tag]` (the setup-const import binding, e.g. `_ctx.Child`). This does
// not breach the whitelist: the whitelist gates ark leaf DOM methods (still
// resolved at build time inside the child's own compiled render); a component is
// a compiled safe module composing those leaves.
//
// Props are emitted as UNIFORM getters — `{ count: () => _ctx.x, msg: () => "hi" }`.
// A getter read inside the child's renderEffect tracks the parent's signal, so a
// dynamic prop stays reactive with no extra machinery; a static prop is just a
// constant getter. The child-side props proxy (component.ts) calls the getter on
// read. `gui` is threaded from render's own param so the child can create nodes.
function genComponent(node: IRComponent, ctx: Ctx): string {
  const name = `n${ctx.counter++}`;
  ctx.lines.push(
    `const ${name} = createComponent(${rewriteExpression(node.tag)}, ${genProps(node.props)}, gui);`,
  );
  return name;
}

function genProps(props: IRComponent["props"]): string {
  if (props.length === 0) return "{}";
  const parts = props.map((p) => {
    const value = p.dynamic ? rewriteExpression(p.value) : JSON.stringify(p.value);
    return `${JSON.stringify(p.name)}: () => ${value}`;
  });
  return `{ ${parts.join(", ")} }`;
}

function genText(node: IRText, ctx: Ctx): string {
  const name = `n${ctx.counter++}`;
  ctx.lines.push(`const ${name} = gui.createRawText();`);
  ctx.lines.push(`${name}.setText(${JSON.stringify(node.value)});`);
  return name;
}

function genInterpolation(node: IRInterpolation, ctx: Ctx): string {
  const name = `n${ctx.counter++}`;
  ctx.lines.push(`const ${name} = gui.createRawText();`);
  ctx.lines.push(`renderEffect(() => setText(${name}, ${rewriteExpression(node.expression)}));`);
  return name;
}

// Resolve a tag to its build-time Ark creator call. No generic createElement —
// each tag maps to a dedicated whitelisted method or throws.
function resolveCreator(tag: string): string {
  const heading = /^h([1-6])$/.exec(tag);
  if (heading) return `gui.createHeading(${heading[1]})`;

  if (FORMATTING_TAGS.has(tag)) return `gui.createFormatting(${JSON.stringify(tag)})`;

  if (tag === "ul") return `gui.createList("unordered")`;
  if (tag === "ol") return `gui.createList("ordered")`;
  if (tag === "dl") return `gui.createList("description")`;

  const creator = TAG_CREATORS[tag];
  if (creator) return `gui.${creator}()`;

  throw new DecaCompileError(
    `Unknown tag <${tag}> — no whitelisted Ark creator. ` +
      `Add it to TAG_CREATORS only if ark-of-atrahasis exposes a safe creator.`,
  );
}
