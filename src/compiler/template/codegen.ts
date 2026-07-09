import { DecaCompileError } from "../errors.ts";
import { TAG_CREATORS, FORMATTING_TAGS, EVENT_METHODS } from "../tables.ts";
import { rewriteExpression } from "./expression.ts";
import type { IRNode, IRElement, IRText, IRInterpolation, IRIf } from "./ir.ts";

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
    ctx.lines.push(`on(${name}, ${JSON.stringify(event.name)}, ${rewriteExpression(event.handler)});`);
  }

  for (const child of node.children) {
    if (child.kind === "if") {
      genNestedIf(child, name, ctx);
      continue;
    }
    const childName = genNode(child, ctx);
    ctx.lines.push(`append(${name}, ${childName});`);
  }

  return name;
}

// Root-level v-if: emit the anchor const, return a `rootIf(...)` marker as a
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
