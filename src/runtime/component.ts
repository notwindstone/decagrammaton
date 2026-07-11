import type { SafeElement, SafeDocument, SafeTextNode } from "ark-of-atrahasis";
import { createScope, runWithScope, getCurrentScope, type Scope } from "../reactivity.ts";
import { createContext, createProps, createIf, isRootIf, createFor, isRootFor } from "./helpers.ts";

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
          } else if (isRootFor(node)) {
            // Same trip-wire as isRootIf: the anchor is appended, then createFor
            // synchronously inserts the initial rows before it (flush:"sync").
            container.appendChild(node.anchor as SafeTextNode);
            createFor(container, node.anchor, node.config);
          } else {
            container.appendChild(node as SafeElement);
          }
        }
      });

      return () => scope.dispose();
    },
  };
}

// Mount a child component instance (slice 6). Called from a parent's generated
// render() for every `<Child …/>` tag: `createComponent(_ctx.Child, props, gui)`.
//
// Mirrors createApp.mount, with three differences: (1) the child scope is
// parented to the CURRENT scope (getCurrentScope, active because the parent's
// render runs inside runWithScope), so disposing the parent tears the child down
// too — same lineage discipline as createIf/createFor; (2) props flow in: the
// codegen getters are wrapped by createProps and handed to BOTH setup(__props)
// and createContext's fall-through layer, so a prop read inside a child effect
// tracks the parent signal; (3) it RETURNS the child's root node instead of
// appending — the parent's render splices it like any other node.
//
// Single-root only (architect ruling): the child's render must yield exactly one
// node, and it must be a real node — a root-level v-if/v-for marker has no
// container to bind into here (that is the deferred fragment machinery). Both
// cases fail loud rather than silently mounting nothing.
export function createComponent(
  module: ComponentModule,
  propGetters: Record<string, () => unknown>,
  gui: SafeDocument,
): SafeElement {
  if (module == null || typeof module.setup !== "function" || typeof module.render !== "function") {
    throw new Error("createComponent: target is not a component (missing setup/render).");
  }

  const scope: Scope = createScope(getCurrentScope());
  const props = createProps(propGetters);

  return runWithScope(scope, () => {
    const setupResult = module.setup(props, { expose: () => {} });
    const ctx = createContext(setupResult, props);
    const nodes = module.render(ctx, gui);

    if (nodes.length !== 1) {
      throw new Error(
        `A component must have exactly one root node (got ${nodes.length}); ` +
          `multi-root components are not supported in this slice.`,
      );
    }
    const root = nodes[0];
    if (isRootIf(root) || isRootFor(root)) {
      throw new Error(
        "A component root cannot be a bare v-if/v-for; wrap it in a single root element.",
      );
    }
    return root as SafeElement;
  });
}
