import { watchStructure, withMountBatch } from "./lifecycle.ts";
import type { TreeOperations } from "ark-of-atrahasis";
import { getCurrentScope } from "../reactivity.ts";
import { getCurrentInstance, runWithInstance } from "./instance.ts";
import {
  rollback,
  mountFragment,
  group,
  type Block,
  type Factory,
  type Fragment,
} from "./fragment.ts";

export function createIf(
  parent: TreeOperations,
  anchor: Block,
  branches: { condition: (() => unknown) | null; factory: Factory }[],
): Block {
  const scope = getCurrentScope();
  const instance = getCurrentInstance();
  let current: Fragment | undefined;
  let index = -1;
  watchStructure(
    () => branches.findIndex((b) => !b.condition || b.condition()),
    (next) => {
      if (next === index) return;
      try {
        withMountBatch(() => {
          const replacement =
            next >= 0
              ? mountFragment(
                  () =>
                    runWithInstance(instance, () =>
                      branches[next].factory(parent, anchor.first()),
                    ),
                  scope,
                )
              : undefined;
          const old = current;
          current = replacement;
          index = next;
          old?.dispose();
        });
      } catch (error) {
        const failed = current;
        current = undefined;
        index = -1;
        rollback(error, failed ? [failed] : []);
      }
    },
  );
  return group([
    {
      first: () => current?.first(),
      move(p, a) {
        parent = p;
        current?.move(p, a);
      },
    },
    anchor,
  ]);
}
