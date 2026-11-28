import { moveSelectOwner, releaseSelectOwner } from "./model.ts";
import type {
  SafeElement,
  SafeTextNode,
  TreeOperations,
} from "ark-of-atrahasis";
import { createScope, getCurrentScope, type Scope } from "../reactivity.ts";
import { withMountBatch } from "./lifecycle.ts";

export type Node = SafeElement | SafeTextNode;
export interface Block {
  first(): Node | undefined;
  move(parent: TreeOperations, before?: Node): void;
}
export interface Fragment extends Block {
  dispose(): void;
}
export type Factory = (parent: TreeOperations, before?: Node) => Block;

export function group(parts: Block[]): Block {
  return {
    first: () => {
      for (const part of parts) {
        const node = part.first();
        if (node) return node;
      }
    },
    move(parent, before) {
      for (const part of parts) part.move(parent, before);
    },
  };
}

const resources = new WeakMap<Scope, Scope>();
export function mountFragment(
  build: () => Block,
  parentScope: Scope | null | undefined = getCurrentScope(),
): Fragment {
  const scope = createScope(parentScope ?? undefined);
  // Sigrea unwinds cleanups in reverse order. Release DOM after setup hooks and effects.
  resources.set(scope, createScope(scope));
  try {
    const block = withMountBatch(() => scope.run(build), parentScope === null);
    return {
      first: () => block.first(),
      move: (parent, before) => block.move(parent, before),
      dispose: () => scope.dispose(),
    };
  } catch (error) {
    rollback(error, [scope]);
  }
}

export function rollback(
  trigger: unknown,
  owned: Iterable<{ dispose(): void }>,
): never {
  const errors = [trigger];
  for (const item of owned) {
    try {
      item.dispose();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 1)
    throw new AggregateError(errors, "Mount and rollback failed.", {
      cause: trigger,
    });
  throw trigger;
}

export function place(
  node: Node,
  parent: TreeOperations,
  before?: Node,
): Block {
  let previous: TreeOperations | undefined;
  resources.get(getCurrentScope()!)!.addCleanup(() => {
    node.dispose();
    if (previous) releaseSelectOwner(node, previous);
  });
  function move(target: TreeOperations, anchor?: Node) {
    if (anchor) target.insertBefore(node, anchor);
    else target.appendChild(node);
    const old = previous;
    previous = target;
    moveSelectOwner(node, target, old);
  }
  move(parent, before);
  return { first: () => node, move };
}
