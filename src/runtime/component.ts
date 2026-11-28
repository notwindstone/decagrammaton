import type { SafeDocument, TreeOperations } from "ark-of-atrahasis";
import { getCurrentScope } from "../reactivity.ts";
import { createContext, createProps, type PropsOptions } from "./context.ts";
import {
  createInstance,
  getCurrentInstance,
  runWithInstance,
} from "./instance.ts";
import {
  mountFragment,
  type Factory,
  type Node,
  type Block,
} from "./fragment.ts";

export type Slots = Record<string, Factory>;
export interface ComponentModule {
  props?: PropsOptions;
  setup(
    props: Record<string, unknown>,
    ctx: { expose(value?: unknown): void },
  ): Record<string, unknown>;
  render(
    ctx: Record<string, unknown>,
    gui: SafeDocument,
    parent: TreeOperations,
    before?: Node,
    slots?: Slots,
    props?: Record<string, unknown>,
  ): Block;
}
export interface AppInstance {
  mount(gui: SafeDocument, container?: TreeOperations): () => void;
}
export function createApp(
  root: ComponentModule,
  props: Record<string, unknown> = {},
): AppInstance {
  return {
    mount(gui, container = gui) {
      const getters = Object.fromEntries(
        Object.keys(props).map((key) => [
          key,
          () => (Object.hasOwn(props, key) ? props[key] : undefined),
        ]),
      );
      return createComponent(
        root,
        getters,
        gui,
        container,
        undefined,
        undefined,
        true,
      ).dispose;
    },
  };
}
export function createComponent(
  module: ComponentModule,
  getters: Record<string, () => unknown>,
  gui: SafeDocument,
  parent: TreeOperations,
  before?: Node,
  slots?: Slots,
  detached = false,
) {
  const author = detached ? null : getCurrentInstance();
  const parentScope = getCurrentScope();
  const instance = createInstance(author);
  const wrapped: Slots = {};
  for (const [name, factory] of Object.entries(slots ?? {})) {
    wrapped[name] = (target, anchor) =>
      mountFragment(
        () => runWithInstance(author, () => factory(target, anchor)),
        getCurrentScope() ?? parentScope,
      );
  }
  return mountFragment(
    () =>
      runWithInstance(instance, () => {
        const props = createProps(getters, module.props);
        const ctx = createContext(module.setup(props, { expose() {} }), props);
        return module.render(ctx, gui, parent, before, wrapped, props);
      }),
    detached ? null : parentScope,
  );
}
export function mountSlot(
  parent: TreeOperations,
  before: Node | undefined,
  slots: Slots | undefined,
  fallback: Factory,
) {
  return (slots?.default ?? fallback)(parent, before);
}
