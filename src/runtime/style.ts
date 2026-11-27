import type { SafeDocument, SafeElement, SafeStyleSheet } from "ark-of-atrahasis";
import { canonicalizeStyleProperty } from "ark-of-atrahasis/validators";
import { onDispose } from "../reactivity.ts";

const sheets = new WeakMap<SafeDocument, Map<object, { sheet: SafeStyleSheet; count: number }>>();
export function mountStyle(gui: SafeDocument, css: string, id: object) {
  let registry = sheets.get(gui);
  if (!registry) sheets.set(gui, (registry = new Map()));
  const shared = registry.get(id);
  const entry = shared ?? { sheet: gui.createStyle(), count: 0 };
  entry.count++;
  function release() {
    if (--entry.count === 0) {
      registry!.delete(id);
      entry.sheet.dispose();
    }
  }
  const unregister = onDispose(release);
  if (!shared) {
    try {
      entry.sheet.setCSS(css);
      registry.set(id, entry);
    } catch (error) {
      unregister();
      release();
      throw error;
    }
  }
}

function declarations(source: string, add: (key: string, value: string) => void) {
  let start = 0,
    colon = -1,
    depth = 0,
    quote = "";
  for (let i = 0; i <= source.length; i++) {
    const c = source[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (quote) {
      if (c === quote) quote = "";
      continue;
    }
    if (c === "'" || c === '"') quote = c;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (!depth && c === ":" && colon < 0) colon = i;
    else if (!depth && (c === ";" || c === undefined)) {
      if (colon >= start) add(source.slice(start, colon).trim(), source.slice(colon + 1, i).trim());
      start = i + 1;
      colon = -1;
    }
  }
}
const applied = new WeakMap<SafeElement, Set<string>>();
export function setStyle(el: SafeElement, ...styles: unknown[]) {
  const prev = applied.get(el) ?? new Set<string>();
  applied.set(el, prev);
  for (const key of prev) el.style.remove(key);
  prev.clear();
  function add(key: string, value: unknown) {
    const name = canonicalizeStyleProperty(key);
    if (name && value != null && value !== "" && el.style.set(name, String(value))) prev.add(name);
  }
  function collect(value: unknown) {
    if (typeof value === "string") declarations(value, add);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object")
      Object.entries(value).forEach(([key, v]) => add(key, v));
  }
  styles.forEach(collect);
}
