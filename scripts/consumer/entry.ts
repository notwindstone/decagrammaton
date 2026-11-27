import type { SafeDocument } from "ark-of-atrahasis";
import { createApp } from "decagrammaton";
import Parent from "./Parent.vue";
export function mount(gui: SafeDocument, position?: number) {
  return createApp(Parent, { position }).mount(gui);
}
