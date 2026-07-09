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

export type IRNode = IRElement | IRText | IRInterpolation;

export interface IRElement {
  kind: "element";
  // The source tag, e.g. "button". Codegen maps it to an Ark creator.
  tag: string;
  // Event bindings from `@event` / `v-on`. `handler` is a template expression.
  events: Array<{ name: string; handler: string }>;
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
