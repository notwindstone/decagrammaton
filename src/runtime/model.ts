import type { SafeSelectElement } from "ark-of-atrahasis";
import { onDispose, watchEffect } from "../reactivity.ts";
import { afterOptionChanges } from "./lifecycle.ts";

export function toModelNumber(raw: string): string | number {
  const n = parseFloat(raw);
  return isNaN(n) ? raw : n;
}

export function modelArrayHas(model: unknown, value: string): boolean {
  if (model == null) return false;
  if (!Array.isArray(model)) {
    throw new Error(
      "v-model on a checkbox with a `value` expects an array model.",
    );
  }
  return model.includes(value);
}

export function modelArrayToggle(
  model: unknown,
  value: string,
  checked: boolean,
): Array<unknown> {
  const base = Array.isArray(model) ? model : [];
  if (checked) {
    return base.includes(value) ? base.slice() : [...base, value];
  }
  return base.filter((v) => v !== value);
}

interface Selection {
  select: SafeSelectElement;
  apply?: () => void;
}
const owners = new WeakMap<object, Selection>();
export function prepareSelect(select: SafeSelectElement) {
  owners.set(select, { select });
}
const children = new WeakMap<object, Set<object>>();
export function moveSelectOwner(
  node: object,
  parent: object,
  previous?: object,
) {
  if (parent !== previous) {
    if (previous) children.get(previous)?.delete(node);
    let siblings = children.get(parent);
    if (!siblings) children.set(parent, (siblings = new Set()));
    siblings.add(node);
    const next = owners.get(parent);
    const old = owners.get(node);
    if (old?.select !== node && old !== next) {
      // Descendants inherit the new select when their enclosing block moves.
      const pending = [node];
      while (pending.length) {
        const item = pending.pop()!;
        if (owners.get(item) !== old) continue;
        if (next) owners.set(item, next);
        else owners.delete(item);
        for (const child of children.get(item) ?? []) pending.push(child);
      }
      if (old?.apply) afterOptionChanges(old.apply);
    }
  }
  optionsChanged(node);
}
export function releaseSelectOwner(node: object, parent: object) {
  children.get(parent)?.delete(node);
  optionsChanged(node);
  owners.delete(node);
}
export function optionsChanged(node: object) {
  const update = owners.get(node)?.apply;
  if (update) afterOptionChanges(update);
}
export function bindSelect(select: SafeSelectElement, read: () => unknown) {
  const owner = owners.get(select)!;
  let value = "";
  owner.apply = () => {
    if (owner.apply) select.setValue(value);
  };
  onDispose(() => {
    owner.apply = undefined;
  });
  watchEffect(
    () => {
      value = String(read() ?? "");
      owner.apply!();
    },
    { flush: "sync" },
  );
}
