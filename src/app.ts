import type { SafeElement, SafeDocument, SafeStyleSheet } from "ark-of-atrahasis";

import { mount } from "./utils/render.ts";
import type { TemplateNode } from "./compiler/parser.ts";
import type { ComponentDefinitionType } from "./types/component/component-definition.type.ts";

export interface DecaModule {
  compile(
    globals: Record<string, unknown>,
    provideFn?: (key: string, value: unknown) => void,
    injectFn?: (key: string) => unknown,
  ): {
    template: Array<unknown>;
    scope: Record<string, unknown>;
    mount: (container: SafeElement, gui: SafeDocument) => () => void;
  };
  toComponent(globals: Record<string, unknown>): ComponentDefinitionType;
  __styles?: string;
  __requires?: Array<string>;
}

export interface AppInstance {
  provide(globals: Record<string, unknown>): AppInstance;
  component(name: string, mod: DecaModule): AppInstance;
  mount(container: SafeElement, gui: SafeDocument): () => void;
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

    mount(container: SafeElement, gui: SafeDocument): () => void {
      const componentDefs: Record<string, ComponentDefinitionType> = {};

      for (const [name, mod] of registeredComponents) {
        componentDefs[name] = mod.toComponent(providedGlobals);
      }

      const rootContext = Object.create(null) as Record<string, unknown>;
      const provideFn = (key: string, value: unknown) => { rootContext[key] = value; };
      const injectFn = () => undefined;
      const allGlobals = { ...providedGlobals, ...componentDefs };
      const compiled = rootModule.compile(allGlobals, provideFn, injectFn);

      let styleSheet: SafeStyleSheet | undefined;
      if (rootModule.__styles) {
        styleSheet = gui.createStyle();

        styleSheet.setCSS(rootModule.__styles);
      }

      const templateCleanup = mount(
        compiled.template as Array<TemplateNode>,
        container,
        compiled.scope,
        gui,
        registeredComponents.size > 0 ? componentDefs : undefined,
        rootContext,
      );

      return () => {
        templateCleanup();
        if (styleSheet) styleSheet.remove();
      };
    },
  };

  return instance;
}
