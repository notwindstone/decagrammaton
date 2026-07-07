declare module "*.deca" {
  import type { SafeElement, SafeDocument } from "decagrammaton";

  interface CompiledComponent {
    template: Array<unknown>;
    scope: Record<string, unknown>;
    mount: (container: SafeElement, gui: SafeDocument) => () => void;
  }

  interface ComponentDefinition {
    template: Array<unknown>;
    factory: (props?: Record<string, unknown>) => Record<string, unknown>;
  }

  const mod: {
    compile(globals: Record<string, unknown>): CompiledComponent;
    toComponent(globals: Record<string, unknown>): ComponentDefinition;
    __styles: string;
    __requires: Array<string>;
  };

  export default mod;
}

declare module "decagrammaton" {
  export function createApp(rootModule: DecaModule): AppInstance;

  export function $signal<T>(initialValue: T): SignalType<T>;
  export function $computed<T>(getter: () => T): ComputedType<T>;
  export function $effect(fn: () => void | (() => void)): () => void;
  export function startBatch(): void;
  export function endBatch(): void;

  export interface SignalType<T> {
    value: T;
  }

  export interface ComputedType<T> {
    readonly value: T;
  }

  export interface AppInstance {
    provide(globals: Record<string, unknown>): AppInstance;
    component(name: string, mod: DecaModule): AppInstance;
    mount(container: SafeElement, gui: SafeDocument): () => void;
  }

  interface DecaModule {
    compile(globals: Record<string, unknown>): CompiledComponent;
    toComponent(globals: Record<string, unknown>): ComponentDefinition;
    __styles?: string;
    __requires?: Array<string>;
  }

  interface SafeElement {
    appendChild(child: SafeElement | SafeTextNode): void;
    insertBefore(newChild: SafeElement | SafeTextNode, reference: SafeElement | SafeTextNode): void;
    removeChild(child: SafeElement | SafeTextNode): void;
    remove(): void;
    setText(value: string): void;
    getText(): string;
    setClass(value: string): void;
    setId(value: string): void;
    style: Record<string, string>;
  }

  interface SafeTextNode {
    setText(value: string): void;
    getText(): string;
    remove(): void;
  }

  interface SafeDocument {
    createDiv(): SafeElement;
    createRawText(): SafeTextNode;
    getElement(id: string): SafeElement | null;
  }
}
