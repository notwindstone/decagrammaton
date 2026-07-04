import type { TemplateNode } from "../../compiler/parser.ts";

export interface ComponentDefinitionType {
  template: Array<TemplateNode>;
  factory: () => Record<string, unknown>;
}
