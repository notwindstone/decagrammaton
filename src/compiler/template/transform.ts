import {
  type RootNode,
  type TemplateChildNode,
  type ElementNode,
  type DirectiveNode,
  type SimpleExpressionNode,
  NodeTypes,
} from "@vue/compiler-core";
import { DecaCompileError } from "../errors.ts";
import type { IRNode, IRElement, IRIf, IRFor, IRComponent, IRModel } from "./ir.ts";

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

function transformElement(node: ElementNode): IRElement | IRComponent {
  // Component tags (tagType 1) are resolved at RUNTIME via `_ctx[tag]`, not via a
  // build-time ark creator — a component is a compiled safe module, not a leaf.
  // Routing here (the single ElementNode handler) means components compose
  // everywhere an element does: as a child, a v-if branch root, or a v-for row.
  // Slots (2) and <template> (3) remain unsupported.
  if (node.tagType === 1) {
    return transformComponent(node);
  }
  if (node.tagType !== 0) {
    throw new DecaCompileError(
      `Unsupported element "${node.tag}" (slots/<template> not in this slice).`,
    );
  }

  const events: IRElement["events"] = [];
  const attrs: IRElement["attrs"] = [];
  let modelDir: DirectiveNode | null = null;

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

      // v-model: a two-way binding, at most one per element. It is validated and
      // lowered AFTER the loop (buildModel) because the static `type`/`value`
      // attrs it depends on — to pick the checkbox/radio kind and to detect a
      // `value` conflict — can appear in any order relative to the directive.
      // Here we only capture it and forbid duplicates.
      if (dir.name === "model") {
        if (modelDir !== null) {
          throw new DecaCompileError(
            `Multiple v-model bindings on <${node.tag}> are not supported (one per element).`,
          );
        }
        modelDir = dir;
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
    model: modelDir ? buildModel(modelDir, node, attrs) : null,
    children: transformChildren(node.children),
  };
}

// Lower a captured v-model directive into an IRModel, using the element's
// already-collected static attrs to pick the kind and enforce conflicts.
//
// Rules (all fail loud — the codebase's whole ethos is "reject rather than
// silently mis-bind"):
//   - v-model:arg (`v-model:foo`) — component v-model with a named model is out
//     of scope; only the default model is supported.
//   - a missing expression.
//   - `.number`/`.trim` on a checkbox/radio — nonsensical (the model is a
//     boolean / the fixed radio value), so reject rather than silently ignore.
//   - a `:type` DYNAMIC bind — the kind must be known at build time to choose
//     the getter/setter pair; a runtime-varying type has no single lowering.
//   - a `value` / `:value` on text or checkbox — it fights the model for the
//     same DOM property (v-model owns value/checked). Radio REQUIRES a static
//     `value` (that is the value it writes back), so it is the one exception.
function buildModel(
  dir: DirectiveNode,
  node: ElementNode,
  attrs: IRElement["attrs"],
): IRModel {
  if (dir.arg) {
    const arg = dir.arg as SimpleExpressionNode;
    throw new DecaCompileError(
      `v-model:${arg.content} on <${node.tag}> (named/component models) is not supported in this slice.`,
    );
  }

  const exp = dir.exp as SimpleExpressionNode | undefined;
  if (!exp || exp.content.trim() === "") {
    throw new DecaCompileError(`v-model on <${node.tag}> has no expression.`);
  }

  // Reject a dynamic `:type` — the kind is a build-time decision.
  for (const prop of node.props) {
    if (prop.type === NodeTypes.DIRECTIVE) {
      const d = prop as DirectiveNode;
      if (d.name === "bind") {
        const arg = d.arg as SimpleExpressionNode | undefined;
        if (arg && arg.isStatic && arg.content.toLowerCase() === "type") {
          throw new DecaCompileError(
            `v-model on <${node.tag}> requires a static \`type\` (a dynamic :type has no single lowering).`,
          );
        }
      }
    }
  }

  // Modifiers arrive as expression nodes (probe-confirmed), so read `.content`.
  const mods = new Set(
    (dir.modifiers as ReadonlyArray<{ content: string }>).map((m) => m.content),
  );
  const lazy = mods.has("lazy");
  const number = mods.has("number");
  const trim = mods.has("trim");

  // The tag drives the element family; only <input> subdivides by `type`.
  const tag = node.tag.toLowerCase();
  if (tag !== "input" && tag !== "textarea" && tag !== "select") {
    throw new DecaCompileError(
      `v-model on <${node.tag}> is not supported — only <input>, <textarea>, and <select>.`,
    );
  }

  const staticType = attrs.find((a) => a.name.toLowerCase() === "type" && !a.dynamic)?.value;
  const hasValueAttr = attrs.some((a) => a.name.toLowerCase() === "value");
  const staticValueAttr = attrs.find((a) => a.name.toLowerCase() === "value" && !a.dynamic)?.value;

  let kind: IRModel["kind"] = "text";
  let staticValue: string | null = null;

  if (tag === "select") {
    kind = "select";
  } else if (tag === "input" && staticType === "checkbox") {
    // A checkbox with a static `value` is Vue's ARRAY binding (checked ⇔ the
    // value is a member); a bare checkbox is the boolean binding. The decision
    // is made here at build time from the presence of a static value.
    if (staticValueAttr !== undefined) {
      kind = "checkbox-array";
      staticValue = staticValueAttr;
    } else {
      kind = "checkbox";
    }
  } else if (tag === "input" && staticType === "radio") {
    kind = "radio";
    if (staticValueAttr === undefined) {
      throw new DecaCompileError(
        `v-model on a radio <${node.tag}> requires a static \`value\` (that is the value it selects).`,
      );
    }
    staticValue = staticValueAttr;
  }

  if ((kind === "checkbox" || kind === "checkbox-array" || kind === "radio") && (number || trim)) {
    throw new DecaCompileError(
      `v-model .number/.trim modifiers are meaningless on a ${kind === "radio" ? "radio" : "checkbox"} <${node.tag}>.`,
    );
  }

  // value/checked belongs to v-model. Radio's `value` (the write-back value) and
  // an array-checkbox's `value` (the array member) are the exceptions — there the
  // static value IS the model's data, not a competing bind. A boolean checkbox or
  // a text input must not carry a `value`.
  if (kind !== "radio" && kind !== "checkbox-array" && hasValueAttr) {
    throw new DecaCompileError(
      `<${node.tag}> has both v-model and a \`value\` — v-model owns the value; remove one.`,
    );
  }

  return { kind, expression: exp.content, staticValue, lazy, number, trim };
}

// Lower a component tag (tagType 1) into an IRComponent. Props are captured the
// same way element attrs are (static NodeTypes.ATTRIBUTE vs dynamic `:prop`
// v-bind), but with author casing preserved — component prop names are
// case-sensitive. Structural directives (v-if/v-else*/v-for and the v-for `:key`)
// are consumed by the grouping passes and skipped here, exactly as for elements.
// Component `@events` (defineEmits) and slots are out of this slice — fail loud.
function transformComponent(node: ElementNode): IRComponent {
  if (node.children.length > 0) {
    throw new DecaCompileError(
      `Slots on <${node.tag}> are not in this slice (component children unsupported).`,
    );
  }

  const props: IRComponent["props"] = [];

  for (const prop of node.props) {
    if (prop.type === NodeTypes.DIRECTIVE) {
      const dir = prop as DirectiveNode;

      // Consumed by the grouping / for passes before this element renders.
      if (dir.name === "if" || dir.name === "else-if" || dir.name === "else") continue;
      if (dir.name === "for") continue;

      if (dir.name === "model") {
        throw new DecaCompileError(
          `v-model on component <${node.tag}> is not supported in this slice ` +
            `(component models need defineModel/emits).`,
        );
      }

      if (dir.name === "bind") {
        const arg = dir.arg as SimpleExpressionNode | undefined;
        // The v-for `:key` on a component element is consumed by transformFor.
        if (arg && arg.isStatic && arg.content === "key") continue;
        if (!arg || !arg.isStatic) {
          throw new DecaCompileError(
            `Dynamic prop names on <${node.tag}> are not supported.`,
          );
        }
        const exp = dir.exp as SimpleExpressionNode | undefined;
        if (!exp) {
          throw new DecaCompileError(
            `:${arg.content} on <${node.tag}> has no expression.`,
          );
        }
        props.push({ name: arg.content, value: exp.content, dynamic: true });
        continue;
      }

      if (dir.name === "on") {
        throw new DecaCompileError(
          `Component events (@${(dir.arg as SimpleExpressionNode | undefined)?.content ?? ""}) ` +
            `on <${node.tag}> are not in this slice (defineEmits comes later).`,
        );
      }

      throw new DecaCompileError(
        `Unsupported directive "v-${dir.name}" on <${node.tag}> in this slice.`,
      );
    }

    // Static prop: `msg="hi"`. A valueless prop (`disabled`) becomes boolean
    // true — Vue's presence semantics — emitted as the literal string "true"
    // (codegen JSON-stringifies static values; a real boolean would need a
    // separate emit path, and props are untyped here, so the string is fine).
    props.push({
      name: prop.name,
      value: prop.value?.content ?? "true",
      dynamic: false,
    });
  }

  return { kind: "component", tag: node.tag, props };
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
