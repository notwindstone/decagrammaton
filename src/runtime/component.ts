import type { SafeElement, SafeDocument, SafeTextNode } from "ark-of-atrahasis";
import { createScope, runWithScope, getCurrentScope, type Scope } from "../reactivity.ts";
import { createContext, createProps, createIf, isRootIf, createFor, isRootFor, type Slots, type SlotFn } from "./helpers.ts";
import {
  createInstance,
  getCurrentInstance,
  runWithInstance,
  type ComponentInstance,
} from "./instance.ts";
import { openMountBatch, flushMountBatch } from "./lifecycle.ts";

// A compiled component module, as produced by the vite plugin: the setup()
// factory plus the generated render() function. render() takes an optional
// `$slots` — the parent-supplied slot factories (currently just `default`);
// absent for the root and for any childless component.
export interface ComponentModule {
  setup: (props: Record<string, unknown>, ctx: { expose: (e?: unknown) => void }) => Record<string, unknown>;
  render: (ctx: Record<string, unknown>, gui: SafeDocument, slots?: Slots) => Array<unknown>;
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

      // The root instance has no parent (provides = Object.create(null)). The
      // currentInstance bracket spans setup AND render: children are created by
      // createComponent during render(), so they must see this instance as their
      // parent. Restored in finally — after the synchronous mount block returns,
      // currentInstance is null, so a provide/inject from a later event handler
      // throws (setup-only, ruling 3).
      const instance: ComponentInstance = createInstance(null);

      // Open the lifecycle mount batch for the whole tree. setup() (here and in
      // every descendant createComponent) registers onMounted callbacks into it;
      // they are flushed below, once all roots are in the live DOM — so an
      // onMounted callback sees its own nodes mounted. openMountBatch returns true
      // for this outermost site (no batch was open), so this site owns the flush.
      openMountBatch();

      runWithScope(scope, () => {
        runWithInstance(instance, () => {
          const setupResult = root.setup({}, { expose: () => {} });
          const ctx = createContext(setupResult);
          const nodes = root.render(ctx, gui, {});

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
      });

      // Whole tree is in the DOM: run every collected onMounted (LIFO — deepest
      // component first, matching Vue's child-before-parent order).
      flushMountBatch();

      return () => scope.dispose();
    },
  };
}

// Mount a child component instance (slice 6). Called from a parent's generated
// render() for every `<Child …/>` tag: `createComponent(_ctx.Child, props, gui)`,
// or `createComponent(_ctx.Child, props, gui, { default: (_parent) => {…} })` when
// the parent passes slot content between the tags.
//
// Mirrors createApp.mount, with three differences: (1) the child scope is
// parented to the CURRENT scope (getCurrentScope, active because the parent's
// render runs inside runWithScope), so disposing the parent tears the child down
// too — same lineage discipline as createIf/createFor; (2) props flow in: the
// codegen getters are wrapped by createProps and handed to BOTH setup(__props)
// and createContext's fall-through layer, so a prop read inside a child effect
// tracks the parent signal; (3) it RETURNS the child's root nodes (a fragment
// array) instead of appending — the parent's render splices them like any other
// node list.
//
// Slots (slice 7): the parent's slot factories build content that lives in the
// CHILD's DOM but is authored by the PARENT — so each factory is wrapped to run
// under the parent's scope AND instance (captured here, at call time, inside the
// parent's render bracket). That makes slot-content effects register on the parent
// scope (disposed with the parent) and slot-content inject() resolve against the
// parent lineage — exactly the createIf discipline, applied to slot bodies. The
// wrapped slots are handed to the child's render(), which invokes them at its
// `<slot>` outlets via mountSlot.
//
// Multi-root: the child's render may yield N sibling roots (a fragment). We
// return the flat array of real nodes and let the embedding site splice it — an
// element child appends each (appendAll), a render root spreads them into the
// roots array, a v-if branch / v-for row already iterates its node list. So a
// multi-root child behaves exactly like the app root already does in mount().
//
// Two shapes still fail loud: (1) a root-level v-if/v-for MARKER — it carries an
// anchor but no container, and only the *mounting* site (createApp/createIf/
// createFor) knows where to bind it, not this splice-into-parent path; wrap it in
// a real element. (2) zero roots — there is no comment/placeholder node in ark to
// hold a position, and an empty row/branch would strand the reconciler's anchor
// tracking, so a component must render at least one real node.
export function createComponent(
  module: ComponentModule,
  propGetters: Record<string, () => unknown>,
  gui: SafeDocument,
  slots?: Slots,
): Array<SafeElement> {
  if (module == null || typeof module.setup !== "function" || typeof module.render !== "function") {
    throw new Error("createComponent: target is not a component (missing setup/render).");
  }

  // Capture the parent scope/instance BEFORE creating the child's own — slot
  // content is parent-authored and must run under these, not the child's.
  const parentScope = getCurrentScope();
  const scope: Scope = createScope(parentScope);
  const props = createProps(propGetters);

  // The child instance parents onto whatever instance is current at call time.
  // createComponent runs inside the PARENT's render bracket (createApp.mount /
  // an ancestor createComponent set currentInstance before render), so this
  // captures the parent instance — that lineage is what inject() walks. Like the
  // root, the bracket spans this child's setup AND render (its own grandchildren
  // are created during its render), restored in finally.
  const parentInstance = getCurrentInstance();
  const instance: ComponentInstance = createInstance(parentInstance);

  const wrappedSlots = slots ? wrapSlots(slots, parentScope, parentInstance) : undefined;

  return runWithScope(scope, () => {
    return runWithInstance(instance, () => {
      const setupResult = module.setup(props, { expose: () => {} });
      const ctx = createContext(setupResult, props);
      const nodes = module.render(ctx, gui, wrappedSlots);

      if (nodes.length === 0) {
        throw new Error(
          "A component must render at least one root node (got 0); an empty component " +
            "has no node to hold its position.",
        );
      }
      for (const node of nodes) {
        if (isRootIf(node) || isRootFor(node)) {
          throw new Error(
            "A component root cannot be a bare v-if/v-for; wrap it in a single root element.",
          );
        }
      }
      return nodes as Array<SafeElement>;
    });
  });
}

// Wrap each parent-supplied slot factory so it runs under the parent's scope and
// instance, no matter where the child later invokes it (a `<slot>` outlet nested
// in the child's own v-if/v-for runs reactively, outside this call's brackets —
// same hazard createIf/createFor guard against, so we re-establish both here). The
// factory still appends into the outlet element the child hands it; only its
// ambient scope/instance are pinned to the parent. Effects registered by the slot
// body thus dispose with the PARENT scope, and its inject() walks the PARENT
// lineage — correct, because the content was authored in the parent.
function wrapSlots(
  slots: Slots,
  parentScope: Scope | undefined,
  parentInstance: ComponentInstance | null,
): Slots {
  const wrapped: Slots = {};
  for (const name of Object.keys(slots)) {
    const fn: SlotFn = slots[name];
    // parentScope is present in practice — createComponent runs inside the parent's
    // render bracket (createApp/an ancestor set runWithScope before render). Guard
    // the undefined case anyway (a scopeless mount) by running the factory bare
    // under just the parent instance, mirroring createIf's own scope handling.
    wrapped[name] = (parent: SafeElement) => {
      const run = () => runWithInstance(parentInstance, () => fn(parent));
      return parentScope ? runWithScope(parentScope, run) : run();
    };
  }
  return wrapped;
}
