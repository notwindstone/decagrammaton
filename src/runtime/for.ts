import type { TreeOperations } from "ark-of-atrahasis";
import { getCurrentScope, signal } from "../reactivity.ts";
import { getCurrentInstance, runWithInstance } from "./instance.ts";
import {
  rollback,
  mountFragment,
  group,
  type Block,
  type Node,
  type Fragment,
} from "./fragment.ts";
import { isScopeDisposed, watchStructure, withMountBatch } from "./lifecycle.ts";

type Context = Record<string, unknown>;
interface ForConfig {
  ctx: Context;
  aliases: {
    value: string | { destructure: { local: string; key: string | number }[] };
    key: string | null;
    index?: string;
  };
  source(): unknown;
  key: ((value: unknown, index: number) => unknown) | null;
  factory(ctx: Context, parent: TreeOperations, before?: Node): Block;
}
interface Row {
  block: Fragment;
  item: { value: unknown };
  index?: { value: number };
  position: number;
}
export function createFor(
  parent: TreeOperations,
  anchor: Block,
  config: ForConfig,
): Block {
  const scope = getCurrentScope();
  const instance = getCurrentInstance();
  const alias = config.aliases.value;
  const fields =
    typeof alias === "object"
      ? new Map(alias.destructure.map((e) => [e.local, e.key]))
      : undefined;
  let rows = new Map<unknown, Row>();
  function create(value: unknown, i: number, position: number): Row {
    const item = signal(value);
    const index = config.aliases.key ? signal(i) : undefined;
    const ctx = new Proxy(config.ctx, {
      get(target, key: string) {
        if (key === config.aliases.index) return undefined;
        if (key === alias) return item.value;
        if (key === config.aliases.key) return index!.value;
        if (fields?.has(key))
          return (item.value as Context)?.[fields.get(key)!];
        return Reflect.get(target, key);
      },
      set(target, key: string, value) {
        if (fields?.has(key))
          throw new Error("Destructured v-for aliases are read-only.");
        if (key === alias) item.value = value;
        else if (key === config.aliases.key) index!.value = value;
        else return Reflect.set(target, key, value);
        return true;
      },
    });
    const block = mountFragment(
      () =>
        runWithInstance(instance, () =>
          config.factory(ctx, parent, anchor.first()),
        ),
      scope,
    );
    return { item, index, block, position };
  }
  watchStructure(
    () => {
      const values = config.source() ?? [];
      if (!Array.isArray(values))
        throw new Error("v-for source must be an array.");
      const items = Array.from(values);
      const keys = items.map((v, i) =>
        config.key ? config.key(v, i) : i,
      );
      if (config.key) {
        const seen = new Set();
        for (const key of keys) {
          if (seen.has(key))
            throw new Error(
              "v-for keys must be unique; duplicate key: " + String(key),
            );
          seen.add(key);
        }
      }
      return { keys, items };
    },
    ({ keys, items }) => {
      const next = new Map<unknown, Row>();
      const added: Row[] = [];
      try {
        withMountBatch(() => {
          for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            let row = rows.get(key);
            if (row) {
              row.item.value = items[i];
              if (row.index) row.index.value = i;
              if (isScopeDisposed(scope)) return;
            } else {
              row = create(items[i], i, rows.size + added.length);
              added.push(row);
            }
            next.set(key, row);
          }
          for (const [key, row] of rows)
            if (!next.has(key)) row.block.dispose();
          let before = anchor.first();
          let earliest = Infinity;
          for (let i = keys.length - 1; i >= 0; i--) {
            const row = next.get(keys[i])!;
            if (row.position > earliest) row.block.move(parent, before);
            else earliest = row.position;
            before = row.block.first() ?? before;
            row.position = i;
          }
          rows = next;
        });
      } catch (error) {
        // An update or mounted hook may already have run against reused rows.
        // Discard that partial list; the next source update starts at the anchor.
        const partial = new Set([...added, ...rows.values()]);
        rows.clear();
        rollback(
          error,
          Array.from(partial, (row) => row.block),
        );
      }
    },
  );
  return group([
    {
      first() {
        for (const row of rows.values()) {
          const n = row.block.first();
          if (n) return n;
        }
      },
      move(p, a) {
        parent = p;
        for (const row of rows.values()) row.block.move(p, a);
      },
    },
    anchor,
  ]);
}
