import { DecaCompileError } from "../errors.ts";
import { TAG_CREATORS, FORMATTING_TAGS, EVENT_METHODS, ATTR_SETTERS } from "../tables.ts";
import { rewriteExpression, rewriteHandler } from "./expression.ts";
import type { IRNode, IRElement, IRText, IRInterpolation, IRIf, IRFor } from "./ir.ts";

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

export function generate(nodes: Array<IRNode>): string {
  const ctx: Ctx = { lines: [], counter: 0 };
  const roots: Array<string> = [];

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
    `{ value: ${JSON.stringify(node.valueAlias)}, ` +
    `key: ${node.keyAlias === null ? "null" : JSON.stringify(node.keyAlias)}, ` +
    `index: ${node.indexAlias === null ? "null" : JSON.stringify(node.indexAlias)} }`;

  const factory = genRowFactory(node.children, ctx);
  const keyFn = genKeyFn(node);

  return (
    `{ ctx: _ctx, source: ${source}, aliases: ${aliases}, ` +
    `factory: ${factory}, key: ${keyFn} }`
  );
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
    if (child.kind !== "element") {
      throw new DecaCompileError("Internal: v-for row root must be a single element.");
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
function genKeyFn(node: IRFor): string {
  if (node.keyExpr === null) return "null";

  const params: Array<string> = [node.valueAlias];
  const locals = new Set<string>([node.valueAlias]);
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
    if (child.kind !== "element") {
      throw new DecaCompileError("Internal: v-if branch root must be a single element.");
    }
    roots.push(genNode(child, ctx));
  }

  ctx.lines = saved;
  const body = buffer.map((l) => `    ${l}`).join("\n");
  return `() => {\n${body}\n    return [${roots.join(", ")}];\n  }`;
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
