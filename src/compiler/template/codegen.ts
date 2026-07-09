import { DecaCompileError } from "../errors.ts";
import { TAG_CREATORS, FORMATTING_TAGS, EVENT_METHODS } from "../tables.ts";
import { rewriteExpression } from "./expression.ts";
import type { IRNode, IRElement, IRText, IRInterpolation } from "./ir.ts";

// IR -> source string of a `render(_ctx, gui)` function.
//
// The explicit-tree idiom (rewrite plan §2.3): every node is created via a
// whitelisted Ark creator and held in its own `const`. We build top-down —
// create parent, create each child, append child to parent — so there is NEVER
// any `_child` / `_next` DOM traversal and NEVER a `_template("<html>")` string.
// An unknown tag/event has no table entry and throws here at build time.

interface Ctx {
  lines: Array<string>;
  counter: number;
}

export function generate(nodes: Array<IRNode>): string {
  const ctx: Ctx = { lines: [], counter: 0 };
  const roots: Array<string> = [];

  for (const node of nodes) {
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
    const childName = genNode(child, ctx);
    ctx.lines.push(`append(${name}, ${childName});`);
  }

  return name;
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
