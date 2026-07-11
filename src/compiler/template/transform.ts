import {
  type RootNode,
  type TemplateChildNode,
  type ElementNode,
  type DirectiveNode,
  type SimpleExpressionNode,
  NodeTypes,
} from "@vue/compiler-core";
import { DecaCompileError } from "../errors.ts";
import type { IRNode, IRElement, IRIf, IRFor } from "./ir.ts";

// baseParse pre-parses a v-for's `LHS in/of RHS` into `forParseResult` (probe-
// confirmed): `source`/`value`/`key`/`index` arrive as expression nodes, so we
// never hand-split the alias string. `value` (the item alias) is always present
// on a well-formed v-for; `key`/`index` are absent unless the template writes
// `(item, i, idx)`.
interface ForParseResultLike {
  source: SimpleExpressionNode;
  value?: SimpleExpressionNode;
  key?: SimpleExpressionNode;
  index?: SimpleExpressionNode;
}

// Walk the @vue/compiler-core AST into our explicit-tree IR.
//
// Slice 2 handles exactly what the counter needs:
//   - element nodes with `@event` (v-on) directives
//   - static text
//   - {{ interpolation }}
// Slice 3 adds v-if / v-else-if / v-else. baseParse does NOT pre-group these
// (verified by probe): it emits the three `<p>`s as separate sibling ELEMENT
// nodes each carrying an `if` / `else-if` / `else` DirectiveNode. So the
// grouping is ours — transformChildren folds a consecutive if/else-if*/else run
// into one IRIf.
// Anything else (other directives, components, comments) throws — fail loud
// rather than silently drop template content.

export function transform(root: RootNode): Array<IRNode> {
  return transformChildren(root.children);
}

function transformChildren(children: Array<TemplateChildNode>): Array<IRNode> {
  const out: Array<IRNode> = [];

  for (let i = 0; i < children.length; i++) {
    const child = children[i];

    // A v-if opens a conditional group that may span later siblings.
    if (child.type === NodeTypes.ELEMENT) {
      const cond = conditionalDirective(child);
      if (cond) {
        if (cond.name !== "if") {
          throw new DecaCompileError(
            `v-${cond.name} on <${child.tag}> has no matching v-if.`,
          );
        }
        const group = collectIfGroup(children, i);
        out.push(group.node);
        i = group.next - 1; // -1 because the for-loop re-increments
        continue;
      }

      // A v-for is self-contained: one element renders as one reactive list.
      // Unlike v-if it does not fold siblings, so no group scan is needed.
      const forResult = forDirective(child);
      if (forResult) {
        out.push(transformFor(child, forResult));
        continue;
      }
    }

    const node = transformChild(child);
    if (node !== null) out.push(node);
  }

  return out;
}

// Fold the run of if / else-if* / else siblings starting at `start` into one
// IRIf. Whitespace-only text and comments between branches are skipped (Vue
// does the same). `next` is the index of the first sibling NOT consumed.
function collectIfGroup(
  children: Array<TemplateChildNode>,
  start: number,
): { node: IRIf; next: number } {
  const branches: IRIf["branches"] = [];

  const first = children[start] as ElementNode;
  const firstCond = conditionalDirective(first)!; // caller checked it's "if"
  branches.push({ condition: firstCond.exp, children: [transformElement(first)] });

  let i = start + 1;
  while (i < children.length) {
    const c = children[i];

    if (c.type === NodeTypes.TEXT && c.content.trim() === "") { i++; continue; }
    if (c.type === NodeTypes.COMMENT) { i++; continue; }

    if (c.type === NodeTypes.ELEMENT) {
      const cond = conditionalDirective(c);
      if (cond && cond.name === "else-if") {
        branches.push({ condition: cond.exp, children: [transformElement(c)] });
        i++;
        continue;
      }
      if (cond && cond.name === "else") {
        branches.push({ condition: null, children: [transformElement(c)] });
        i++;
        break; // v-else terminates the chain
      }
    }

    break; // any other node ends the group
  }

  return { node: { kind: "if", branches }, next: i };
}

// Return the conditional directive on an element, or null. Throws if v-if /
// v-else-if carry no condition expression.
function conditionalDirective(
  node: ElementNode,
): { name: "if" | "else-if" | "else"; exp: string | null } | null {
  for (const prop of node.props) {
    if (prop.type !== NodeTypes.DIRECTIVE) continue;
    const dir = prop as DirectiveNode;

    if (dir.name === "if" || dir.name === "else-if") {
      const exp = dir.exp as SimpleExpressionNode | undefined;
      if (!exp) {
        throw new DecaCompileError(`v-${dir.name} on <${node.tag}> has no condition.`);
      }
      return { name: dir.name, exp: exp.content };
    }
    if (dir.name === "else") {
      return { name: "else", exp: null };
    }
  }
  return null;
}

// Return the v-for directive's parsed result, or null. baseParse hands us the
// alias split via `forParseResult`; we only surface it here.
function forDirective(node: ElementNode): ForParseResultLike | null {
  for (const prop of node.props) {
    if (prop.type !== NodeTypes.DIRECTIVE) continue;
    const dir = prop as DirectiveNode;
    if (dir.name === "for") {
      const parsed = (dir as unknown as { forParseResult?: ForParseResultLike })
        .forParseResult;
      if (!parsed || !parsed.source) {
        throw new DecaCompileError(`Malformed v-for on <${node.tag}>.`);
      }
      return parsed;
    }
  }
  return null;
}

// Lower a v-for element into an IRFor. The row template is the element rendered
// with its v-for/`:key` directives stripped (they are consumed here, not by the
// row's own transformElement). v-if + v-for on the SAME element is rejected:
// Vue gives v-if higher priority so it cannot see the loop variable — always a
// footgun. Fail loud; nest instead.
function transformFor(node: ElementNode, parsed: ForParseResultLike): IRFor {
  if (conditionalDirective(node)) {
    throw new DecaCompileError(
      `v-if and v-for on the same <${node.tag}> is not supported — ` +
        `wrap the v-for element in a v-if parent (or vice versa) instead.`,
    );
  }

  const value = parsed.value?.content;
  if (!value) {
    throw new DecaCompileError(
      `v-for on <${node.tag}> has no item alias (write \`item in items\`).`,
    );
  }

  return {
    kind: "for",
    source: parsed.source.content,
    valueAlias: value,
    keyAlias: parsed.key?.content ?? null,
    indexAlias: parsed.index?.content ?? null,
    keyExpr: keyBinding(node),
    children: [transformElement(node)],
  };
}

// Extract the `:key` bind expression from a v-for element, or null when
// unkeyed. `:key` arrives as a normal v-bind prop (arg "key").
function keyBinding(node: ElementNode): string | null {
  for (const prop of node.props) {
    if (prop.type !== NodeTypes.DIRECTIVE) continue;
    const dir = prop as DirectiveNode;
    if (dir.name !== "bind") continue;
    const arg = dir.arg as SimpleExpressionNode | undefined;
    if (arg && arg.isStatic && arg.content === "key") {
      const exp = dir.exp as SimpleExpressionNode | undefined;
      if (!exp) {
        throw new DecaCompileError(`:key on <${node.tag}> has no expression.`);
      }
      return exp.content;
    }
  }
  return null;
}

// Transform a single non-conditional, non-loop child. Conditional groups and
// v-for are handled by transformChildren before this is reached.
function transformChild(node: TemplateChildNode): IRNode | null {
  switch (node.type) {
    case NodeTypes.ELEMENT:
      return transformElement(node);

    case NodeTypes.TEXT: {
      // Collapse pure-whitespace text between elements away; keep real text.
      if (node.content.trim() === "") return null;
      return { kind: "text", value: node.content };
    }

    case NodeTypes.INTERPOLATION: {
      const exp = node.content as SimpleExpressionNode;
      return { kind: "interpolation", expression: exp.content };
    }

    case NodeTypes.COMMENT:
      return null;

    default:
      throw new DecaCompileError(
        `Unsupported template node type (${node.type}) in this slice.`,
      );
  }
}

function transformElement(node: ElementNode): IRElement {
  // ElementType 0 = plain element. Components/slots/templates come later.
  if (node.tagType !== 0) {
    throw new DecaCompileError(
      `Unsupported element "${node.tag}" (components/slots not in this slice).`,
    );
  }

  const events: IRElement["events"] = [];
  const attrs: IRElement["attrs"] = [];

  for (const prop of node.props) {
    if (prop.type === NodeTypes.DIRECTIVE) {
      const dir = prop as DirectiveNode;

      // Conditional directives are consumed by the grouping pass in
      // transformChildren; the element itself just renders its own content.
      if (dir.name === "if" || dir.name === "else-if" || dir.name === "else") {
        continue;
      }

      // v-for and its `:key` are consumed by transformFor (which then renders
      // this element as the row template); skip them here.
      if (dir.name === "for") {
        continue;
      }
      if (dir.name === "bind") {
        const arg = dir.arg as SimpleExpressionNode | undefined;
        if (arg && arg.isStatic && arg.content === "key") {
          continue;
        }
        // A dynamic attribute binding: `:class="x"`, `:href="url"`,
        // `:data-id="x"`, … The arg is the attr name; the exp is a template
        // expression codegen wraps in a renderEffect. Dynamic arg names
        // (`:[name]="x"`) have no build-time attr to whitelist — reject.
        if (!arg || !arg.isStatic) {
          throw new DecaCompileError(
            `Dynamic attribute names on <${node.tag}> are not supported.`,
          );
        }
        const exp = dir.exp as SimpleExpressionNode | undefined;
        if (!exp) {
          throw new DecaCompileError(
            `:${arg.content} on <${node.tag}> has no expression.`,
          );
        }
        attrs.push({ name: arg.content, value: exp.content, dynamic: true });
        continue;
      }

      if (dir.name === "on") {
        events.push(transformOn(dir, node.tag));
        continue;
      }

      throw new DecaCompileError(
        `Unsupported directive "v-${dir.name}" on <${node.tag}> in this slice.`,
      );
    }

    // Static/plain attributes (NodeTypes.ATTRIBUTE): `class="foo"`. Captured as
    // a non-dynamic attr — codegen emits one setter call with the literal, no
    // effect wrapper. A valueless attr (`readonly`, `disabled`) has no content
    // and is a boolean-present; ark's boolean setters guard on `if (value)`, so
    // it must be truthy — `"true"`, NOT `""` (empty string is falsy and would
    // silently no-op the attribute). An explicit `class=""` keeps its own empty
    // string (nullish-coalescing only fires when there is no value at all).
    attrs.push({
      name: prop.name,
      value: prop.value?.content ?? "true",
      dynamic: false,
    });
  }

  return {
    kind: "element",
    tag: node.tag,
    events,
    attrs,
    children: transformChildren(node.children),
  };
}

function transformOn(dir: DirectiveNode, tag: string): { name: string; handler: string } {
  const arg = dir.arg as SimpleExpressionNode | undefined;
  if (!arg || !arg.isStatic) {
    throw new DecaCompileError(`Dynamic event names on <${tag}> are not supported in this slice.`);
  }

  const exp = dir.exp as SimpleExpressionNode | undefined;
  if (!exp) {
    throw new DecaCompileError(`Event @${arg.content} on <${tag}> has no handler.`);
  }

  return { name: arg.content, handler: exp.content };
}
