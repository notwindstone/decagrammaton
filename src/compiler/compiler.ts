import type { SafeElement, SafeDocument } from "ark-of-atrahasis";

import { Parser } from "./parser.ts";
import { compileScript, transpileScript } from "./script.ts";
import { mount } from "../utils/render.ts";
import type { ParsedComponentType, TemplateNode } from "./parser.ts";
import type { ComponentDefinitionType, ProvideFn, InjectFn } from "../types/component/component-definition.type.ts";

export class Compiler {
  private readonly filename: string;
  private readonly globals: Map<string, unknown> = new Map();
  private parsed: ParsedComponentType | null = null;

  constructor(filename: string) {
    this.filename = filename;
  }

  provide(name: string, value: unknown): Compiler {
    this.globals.set(name, value);

    return this;
  }

  compile(source: string, provideFn?: ProvideFn, injectFn?: InjectFn): CompiledComponent {
    this.parsed = new Parser(this.filename)
      .put(source)
      .parse();

    const globalNames: Array<string> = [...this.globals.keys()];
    const globalValues: Array<unknown> = [...this.globals.values()];
    const scriptContent: string = this.parsed.script?.lang === "ts"
      ? transpileScript(this.parsed.script.content)
      : (this.parsed.script?.content ?? "");
    const provide = provideFn ?? (() => {});
    const inject = injectFn ?? (() => undefined);
    const compiledScript = compileScript(scriptContent, [...globalNames, "provide", "inject"], this.filename);
    const scope: Record<string, unknown> = {
      ...Object.fromEntries(this.globals),
      ...compiledScript(...globalValues, provide, inject),
    };

    const template = this.parsed.template;

    return {
      template,
      scope,
      mount: (container: SafeElement, gui: SafeDocument) => mount(template, container, scope, gui),
    };
  }

  toComponent(source: string): ComponentDefinitionType {
    this.parsed = new Parser(this.filename)
      .put(source)
      .parse();

    const globalNames: Array<string> = [...this.globals.keys()];
    const globalValues: Array<unknown> = [...this.globals.values()];
    const scriptContent: string = this.parsed.script?.lang === "ts"
      ? transpileScript(this.parsed.script.content)
      : (this.parsed.script?.content ?? "");
    const compiledScript = compileScript(scriptContent, [...globalNames, "defineProps", "provide", "inject"], this.filename);

    return {
      template: this.parsed.template,
      factory: (props?: Record<string, unknown>, provideFn?: ProvideFn, injectFn?: InjectFn) => {
        const defineProps = () => props ?? {};
        const provide = provideFn ?? (() => {});
        const inject = injectFn ?? (() => undefined);

        return {
          ...Object.fromEntries(this.globals),
          ...compiledScript(...globalValues, defineProps, provide, inject),
        };
      },
    };
  }
}

export interface CompiledComponent {
  template: Array<TemplateNode>;
  scope: Record<string, unknown>;
  mount: (container: SafeElement, gui: SafeDocument) => () => void;
}
