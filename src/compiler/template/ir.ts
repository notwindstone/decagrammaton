import type { SourceLocation } from "@vue/compiler-core";
import type { ForValueBinding } from "./expression.ts";

export type IRNode = IRElement | IRText | IRInterpolation | IRIf | IRFor | IRComponent | IRSlot;

export interface IRElement {
  loc: SourceLocation;
  kind: "element";
  tag: string;
  events: Array<{ name: string; handler: string; options: Record<string, true> }>;
  attrs: Array<{ name: string; value: string | null; dynamic: boolean }>;
  model: IRModel | null;
  children: Array<IRNode>;
}

export interface IRModel {
  kind: "text" | "select" | "checkbox" | "checkbox-array" | "radio";
  expression: string;
  staticValue: string | null;
  lazy: boolean;
  number: boolean;
  trim: boolean;
}

export interface IRText {
  loc: SourceLocation;
  kind: "text";
  value: string;
}

export interface IRInterpolation {
  loc: SourceLocation;
  kind: "interpolation";
  expression: string;
}

export interface IRIf {
  loc: SourceLocation;
  kind: "if";
  branches: Array<{ condition: string | null; children: Array<IRNode> }>;
}

export interface IRFor {
  loc: SourceLocation;
  kind: "for";
  source: string;
  valueBinding: ForValueBinding;
  valueAlias: string;
  keyAlias: string | null;
  indexAlias: string | null;
  keyExpr: string | null;
  children: Array<IRNode>;
}

export interface IRComponent {
  loc: SourceLocation;
  kind: "component";
  tag: string;
  props: Array<{ name: string; value: string; dynamic: boolean }>;
  slot: Array<IRNode> | null;
}

export interface IRSlot {
  loc: SourceLocation;
  kind: "slot";
  fallback: Array<IRNode>;
}
