import type { ScriptBlock, TemplateNode } from "../../compiler/parser.ts";

export type ParsedComponentType = {
  script  : ScriptBlock | null;
  template: TemplateNode[];
};