import { optionsChanged } from "./model.ts";
import type {
  DeclarativeListenerOptions,
  SafeElement,
  SafeTextNode,
  EventHandler,
  PublicEventType,
} from "ark-of-atrahasis";
import { watchEffect, onDispose, type WatchHandle } from "../reactivity.ts";
export function on(
  el: SafeElement,
  type: PublicEventType,
  handler: EventHandler,
  options?: DeclarativeListenerOptions,
) {
  onDispose(el.addEventListener(type, handler, options));
}
export function renderEffect(fn: () => void): WatchHandle {
  return watchEffect(fn, { flush: "sync" });
}

export function setText(node: SafeTextNode, value: unknown): void {
  node.setText(value == null ? "" : String(value));
  optionsChanged(node);
}

export function normalizeClass(value: unknown): string {
  if (typeof value === "string") return value;

  if (Array.isArray(value)) {
    let out = "";
    for (const item of value) {
      const normalized = normalizeClass(item);
      if (normalized) out += (out ? " " : "") + normalized;
    }
    return out;
  }

  if (value != null && typeof value === "object") {
    let out = "";
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if ((value as Record<string, unknown>)[key]) out += (out ? " " : "") + key;
    }
    return out;
  }

  return "";
}

export const attributeString = (value: unknown) => String(value ?? "");
export const attributeBoolean = Boolean;
export const attributeNumber = Number;

export function spellcheck(value: unknown) {
  return value === "" || (Boolean(value) && String(value).toLowerCase() !== "false");
}
