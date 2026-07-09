import {
  type RootNode,
  type TemplateChildNode,
  type ElementNode,
  type DirectiveNode,
  type SimpleExpressionNode,
  NodeTypes,
} from "@vue/compiler-core";
import { DecaCompileError } from "../errors.ts";
import type { IRNode, IRElement, IRIf } from "./ir.ts";

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

  for (const prop of node.props) {
    if (prop.type === NodeTypes.DIRECTIVE) {
      const dir = prop as DirectiveNode;

      // Conditional directives are consumed by the grouping pass in
      // transformChildren; the element itself just renders its own content.
      if (dir.name === "if" || dir.name === "else-if" || dir.name === "else") {
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

    // Static/plain attributes (NodeTypes.ATTRIBUTE) arrive in slice 5.
    throw new DecaCompileError(
      `Unsupported attribute on <${node.tag}> in this slice.`,
    );
  }

  return {
    kind: "element",
    tag: node.tag,
    events,
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
