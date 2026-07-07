import type { TemplateNode } from "../../compiler/parser.ts";

export type ProvideFn = (key: string, value: unknown) => void;
export type InjectFn = (key: string) => unknown;

export interface ComponentDefinitionType {
  template: Array<TemplateNode>;
  factory: (
    props?: Record<string, unknown>,
    provide?: ProvideFn,
    inject?: InjectFn,
  ) => Record<string, unknown>;
}
