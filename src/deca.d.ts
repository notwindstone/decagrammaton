declare module "*.deca" {
  interface CompiledComponent {
    template: Array<unknown>;
    scope: Record<string, unknown>;
    mount: (container: HTMLElement) => () => void;
  }

  interface ComponentDefinition {
    template: Array<unknown>;
    factory: () => Record<string, unknown>;
  }

  const mod: {
    compile(globals: Record<string, unknown>): CompiledComponent;
    toComponent(globals: Record<string, unknown>): ComponentDefinition;
  };

  export default mod;
}

declare module "decagrammaton" {
  export function createApp(rootModule: DecaModule): AppInstance;

  export interface AppInstance {
    provide(globals: Record<string, unknown>): AppInstance;
    component(name: string, mod: DecaModule): AppInstance;
    mount(container: HTMLElement): () => void;
  }

  interface DecaModule {
    compile(globals: Record<string, unknown>): CompiledComponent;
    toComponent(globals: Record<string, unknown>): ComponentDefinition;
  }
}
