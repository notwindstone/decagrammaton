// The intermediate representation: an explicit tree of node descriptors.
//
// This is deliberately NOT a template string and NOT the Vue AST. It is a
// flat-buildable description of "create this node, attach these children" that
// codegen walks to emit imperative Ark + sigrea calls. Every element is created
// via a whitelisted Ark creator resolved at build time; an unknown tag has no
// creator and codegen throws.
//
// Slice 2 defines only the three node kinds the counter needs: Element, Text
// (static), and Interpolation ({{ expr }}). v-if / v-for / :attr node kinds are
// added by their own slices.

export type IRNode = IRElement | IRText | IRInterpolation | IRIf | IRFor;

export interface IRElement {
  kind: "element";
  // The source tag, e.g. "button". Codegen maps it to an Ark creator.
  tag: string;
  // Event bindings from `@event` / `v-on`. `handler` is a template expression.
  events: Array<{ name: string; handler: string }>;
  // Attribute bindings (slice 5). `name` is the attr as written in the SFC
  // (e.g. "class", "data-id", "aria-label"); codegen lowercases it for the
  // setter lookup and splits the `data-`/`aria-` prefix. `dynamic` distinguishes
  // a `:attr="expr"` bind (value is a template expression, wrapped in an effect)
  // from a static `attr="literal"` (value is the literal string, one call).
  attrs: Array<{ name: string; value: string; dynamic: boolean }>;
  children: Array<IRNode>;
}

export interface IRText {
  kind: "text";
  // Static, already-decoded text content.
  value: string;
}

export interface IRInterpolation {
  kind: "interpolation";
  // The template expression inside `{{ }}`, e.g. "count".
  expression: string;
}

export interface IRIf {
  kind: "if";
  // Branches for v-if / v-else-if* / v-else. `condition` is null for v-else.
  branches: Array<{ condition: string | null; children: Array<IRNode> }>;
}

export interface IRFor {
  kind: "for";
  // The list expression, e.g. "items" in `v-for="item in items"`. Prefixed
  // against _ctx at codegen (it reads component state, not a row local).
  source: string;
  // Row aliases from forParseResult: `(value, key, index)`. `value` is always
  // present (`item`); `keyAlias`/`indexAlias` are null when the template omits
  // them. These are the row-scoped LOCALS — inside a row, `item` resolves to the
  // current row's value, NOT `_ctx.item`.
  valueAlias: string;
  keyAlias: string | null;
  indexAlias: string | null;
  // The `:key` expression, e.g. "item.id", or null when unkeyed. It reads row
  // locals, so it is prefixed with the aliases seeded as locals.
  keyExpr: string | null;
  // The row template (the v-for element's own subtree, rendered per item).
  children: Array<IRNode>;
}
