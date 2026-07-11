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

import type { ForValueBinding } from "./expression.ts";

export type IRNode = IRElement | IRText | IRInterpolation | IRIf | IRFor | IRComponent;

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
  // A `v-model` two-way binding on this element, or null. At most one per
  // element (multiple v-models fail loud in transform). Carried on the element
  // — not a standalone node — because codegen needs the element's own const to
  // both set it (read direction) and read it back (write direction).
  model: IRModel | null;
  children: Array<IRNode>;
}

// A lowered `v-model`. Unlike a text interpolation, both directions are emitted
// against the owning element's const (codegen only): the read direction sets the
// DOM from state inside a renderEffect; the write direction is an event handler
// that reads the element (getValue/getChecked — NOT `$event.target`, which ark's
// frozen SafeEvent limits to `{ id, value }` with no `.checked`) and assigns back
// through the `_ctx` set-trap. `kind` selects the DOM method pair + default event.
export interface IRModel {
  // Which element shape drives the setter/getter + event choice.
  //   "text"     — text-like <input> / <textarea>: setValue/getValue, input event
  //   "select"   — <select>: setValue/getValue, but commits on `change`
  //   "checkbox" — <input type=checkbox> with NO value: setChecked/getChecked,
  //                boolean model
  //   "checkbox-array" — <input type=checkbox> WITH a static value: the model is
  //                an array; checked ⇔ the value is a member (Vue's array binding)
  //   "radio"    — <input type=radio>: setChecked(model===value), model:=value
  kind: "text" | "select" | "checkbox" | "checkbox-array" | "radio";
  // The model expression as written (`text`, `form.name`). Prefixed against
  // `_ctx` and asserted to be an assignable lvalue (Identifier/MemberExpression)
  // by rewriteModelTarget at codegen.
  expression: string;
  // The element's own static `value` attr. For "radio" it is compared against
  // the model (read) and written back on pick; for "checkbox-array" it is the
  // array member this box toggles. Null for text/checkbox(boolean)/select.
  staticValue: string | null;
  // `.lazy` → bind the `change` event instead of `input` (text/textarea only;
  // checkbox/radio always use `change`).
  lazy: boolean;
  // `.number` → coerce the read-back string via toModelNumber before assigning.
  number: boolean;
  // `.trim` → `.trim()` the read-back string before assigning.
  trim: boolean;
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
  // The value alias binding from forParseResult's LHS: either a plain identifier
  // (`item`) or a destructuring pattern (`{ name, age }`, `[a, b]`). Inside a row,
  // its bound name(s) resolve to the current row's value — an identifier to the
  // whole item, a destructured local to the matching item property/index — NOT to
  // `_ctx.*`. Parsed by parseForValueAlias.
  valueBinding: ForValueBinding;
  // The raw LHS text as written (`item`, `{ name, age }`, `[a, b]`). Kept verbatim
  // for the `:key` function's first param, where native JS destructuring binds the
  // row locals directly (`({ name }, i) => name` needs the pattern, not a name).
  valueAlias: string;
  keyAlias: string | null;
  indexAlias: string | null;
  // The `:key` expression, e.g. "item.id", or null when unkeyed. It reads row
  // locals, so it is prefixed with the aliases seeded as locals.
  keyExpr: string | null;
  // The row template (the v-for element's own subtree, rendered per item).
  children: Array<IRNode>;
}

export interface IRComponent {
  kind: "component";
  // The component tag as written, e.g. "Child". Codegen resolves it at RUNTIME
  // via `_ctx.Child` (the setup-const import binding) — unlike a plain element
  // there is no build-time creator to whitelist, because a component is an
  // already-compiled safe module composing whitelisted ark leaves, not a leaf.
  tag: string;
  // Props passed by the parent. `name` is the prop as written (author casing,
  // preserved — component prop names are case-sensitive, unlike HTML attrs).
  // `dynamic` splits a `:prop="expr"` bind (value is a template expression,
  // read reactively) from a static `prop="literal"` (value is the literal).
  props: Array<{ name: string; value: string; dynamic: boolean }>;
}
