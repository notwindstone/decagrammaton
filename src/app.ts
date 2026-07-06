import { mount } from "./utils/render.ts";
import type { TemplateNode } from "./compiler/parser.ts";
import type { ComponentDefinitionType } from "./types/component/component-definition.type.ts";

export interface DecaModule {
  compile(globals: Record<string, unknown>): {
    template: Array<unknown>;
    scope: Record<string, unknown>;
    mount: (container: HTMLElement) => () => void;
  };
  toComponent(globals: Record<string, unknown>): ComponentDefinitionType;
}

export interface AppInstance {
  provide(globals: Record<string, unknown>): AppInstance;
  component(name: string, mod: DecaModule): AppInstance;
  mount(container: HTMLElement): () => void;
}

export function createApp(rootModule: DecaModule): AppInstance {
  const providedGlobals: Record<string, unknown> = {};
  const registeredComponents: Map<string, DecaModule> = new Map();

  const instance: AppInstance = {
    provide(globals: Record<string, unknown>): AppInstance {
      Object.assign(providedGlobals, globals);
      return instance;
    },

    component(name: string, mod: DecaModule): AppInstance {
      registeredComponents.set(name, mod);
      return instance;
    },

    mount(container: HTMLElement): () => void {
      const componentDefs: Record<string, ComponentDefinitionType> = {};

      for (const [name, mod] of registeredComponents) {
        componentDefs[name] = mod.toComponent(providedGlobals);
      }

      const allGlobals = { ...providedGlobals, ...componentDefs };
      const compiled = rootModule.compile(allGlobals);

      return mount(compiled.template as Array<TemplateNode>, container, compiled.scope, registeredComponents.size > 0 ? componentDefs : undefined);
    },
  };

  return instance;
}
