declare module "*.deca" {
  import type { TemplateNode } from "./compiler/parser.ts";
  import type { ComponentDefinitionType } from "./types/component/component-definition.type.ts";

  interface CompiledComponent {
    template: Array<TemplateNode>;
    scope: Record<string, unknown>;
  }

  const mod: {
    compile(globals: Record<string, unknown>): CompiledComponent;
    toComponent(globals: Record<string, unknown>): ComponentDefinitionType;
  };

  export default mod;
}
