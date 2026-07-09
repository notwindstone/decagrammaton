import type { SafeElement, SafeDocument } from "ark-of-atrahasis";
import { createScope, runWithScope, type Scope } from "../reactivity.ts";
import { createContext } from "./helpers.ts";

// A compiled component module, as produced by the vite plugin: the setup()
// factory plus the generated render() function.
export interface ComponentModule {
  setup: (props: Record<string, unknown>, ctx: { expose: (e?: unknown) => void }) => Record<string, unknown>;
  render: (ctx: Record<string, unknown>, gui: SafeDocument) => Array<SafeElement | { appendChild?: unknown }>;
}

export interface AppInstance {
  mount(container: SafeElement, gui: SafeDocument): () => void;
}

// Mount a root component. Each instance owns one sigrea Scope: setup + render +
// every renderEffect/event cleanup registered via onDispose live under it, so
// tearing the instance down disposes the whole subtree's reactivity at once.
// This replaces the old manual `detached()` / setActiveSub trick.
export function createApp(root: ComponentModule): AppInstance {
  return {
    mount(container: SafeElement, gui: SafeDocument): () => void {
      const scope: Scope = createScope();

      const nodes = runWithScope(scope, () => {
        const setupResult = root.setup({}, { expose: () => {} });
        const ctx = createContext(setupResult);
        return root.render(ctx, gui);
      });

      for (const node of nodes) {
        container.appendChild(node as SafeElement);
      }

      return () => scope.dispose();
    },
  };
}
