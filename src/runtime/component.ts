import type { SafeElement, SafeDocument, SafeTextNode } from "ark-of-atrahasis";
import { createScope, runWithScope, type Scope } from "../reactivity.ts";
import { createContext, createIf, isRootIf } from "./helpers.ts";

// A compiled component module, as produced by the vite plugin: the setup()
// factory plus the generated render() function.
export interface ComponentModule {
  setup: (props: Record<string, unknown>, ctx: { expose: (e?: unknown) => void }) => Record<string, unknown>;
  render: (ctx: Record<string, unknown>, gui: SafeDocument) => Array<unknown>;
}

export interface AppInstance {
  mount(container: SafeElement, gui: SafeDocument): () => void;
}

// Mount a root component. Each instance owns one sigrea Scope: setup + render +
// every renderEffect/event cleanup registered via onDispose live under it, so
// tearing the instance down disposes the whole subtree's reactivity at once.
// This replaces the old manual `detached()` / setActiveSub trick.
//
// render() returns roots that are either real nodes or a RootIfMarker (a
// root-level v-if that could not mount itself — only this site knows the
// container). Both the render call AND the root-if binding run inside the
// component scope so createIf's getCurrentScope() sees it: the branch child
// scopes then parent onto the component scope for full teardown.
export function createApp(root: ComponentModule): AppInstance {
  return {
    mount(container: SafeElement, gui: SafeDocument): () => void {
      const scope: Scope = createScope();

      runWithScope(scope, () => {
        const setupResult = root.setup({}, { expose: () => {} });
        const ctx = createContext(setupResult);
        const nodes = root.render(ctx, gui);

        for (const node of nodes) {
          if (isRootIf(node)) {
            // TRIP-WIRE: correct root ordering is load-bearing on createIf's
            // renderEffect being sync + immediate-first-run (flush:"sync"). The
            // anchor is appended here, then createIf synchronously inserts the
            // initial branch before it. If the flush ever becomes "pre" (async),
            // a trailing real root would appendChild before the deferred branch's
            // insertBefore, reordering siblings on screen. Do NOT change the flush.
            container.appendChild(node.anchor as SafeTextNode);
            createIf(container, node.anchor, node.branches);
          } else {
            container.appendChild(node as SafeElement);
          }
        }
      });

      return () => scope.dispose();
    },
  };
}
