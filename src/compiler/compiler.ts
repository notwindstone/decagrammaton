import { Parser } from "./parser.ts";
import { compileScript } from "./script.ts";
import { mount } from "../utils/render.ts";
import type { ParsedComponentType } from "../types/component/parsed-component.type.ts";
import type { ComponentDefinitionType } from "../types/component/component-definition.type.ts";
import type { TemplateNode } from "./parser.ts";

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

  compile(source: string): CompiledComponent {
    this.parsed = new Parser(this.filename)
      .put(source)
      .parse();

    const globalNames: Array<string> = [...this.globals.keys()];
    const globalValues: Array<unknown> = [...this.globals.values()];
    const scriptContent: string = this.parsed.script?.content ?? "";
    const compiledScript = compileScript(scriptContent, globalNames);
    const scope: Record<string, unknown> = {
      ...Object.fromEntries(this.globals),
      ...compiledScript(...globalValues),
    };

    const template = this.parsed.template;

    return {
      template,
      scope,
      mount: (container: HTMLElement) => mount(template, container, scope),
    };
  }

  toComponent(source: string): ComponentDefinitionType {
    this.parsed = new Parser(this.filename)
      .put(source)
      .parse();

    const globalNames: Array<string> = [...this.globals.keys()];
    const globalValues: Array<unknown> = [...this.globals.values()];
    const scriptContent: string = this.parsed.script?.content ?? "";
    const compiledScript = compileScript(scriptContent, globalNames);

    return {
      template: this.parsed.template,
      factory: () => ({
        ...Object.fromEntries(this.globals),
        ...compiledScript(...globalValues),
      }),
    };
  }
}

export interface CompiledComponent {
  template: Array<TemplateNode>;
  scope: Record<string, unknown>;
  mount: (container: HTMLElement) => () => void;
}
