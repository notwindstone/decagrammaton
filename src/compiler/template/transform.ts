import {
  type RootNode,
  type TemplateChildNode,
  type ElementNode,
  type DirectiveNode,
  type SimpleExpressionNode,
  NodeTypes,
} from "@vue/compiler-core";
import { DecaCompileError } from "../errors.ts";
import type { IRNode, IRElement } from "./ir.ts";

// Walk the @vue/compiler-core AST into our explicit-tree IR.
//
// Slice 2 handles exactly what the counter needs:
//   - element nodes with `@event` (v-on) directives
//   - static text
//   - {{ interpolation }}
// Anything else (other directives, components, comments) throws — fail loud
// rather than silently drop template content.

export function transform(root: RootNode): Array<IRNode> {
  return transformChildren(root.children);
}

function transformChildren(children: Array<TemplateChildNode>): Array<IRNode> {
  const out: Array<IRNode> = [];

  for (const child of children) {
    const node = transformChild(child);
    if (node !== null) out.push(node);
  }

  return out;
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
