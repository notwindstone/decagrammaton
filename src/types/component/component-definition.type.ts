import type { TemplateNode } from "../../compiler/parser.ts";

export interface ComponentDefinitionType {
  template: Array<TemplateNode>;
  factory: (props?: Record<string, unknown>) => Record<string, unknown>;
}
