import type { ProxiesType } from "../types/reactivity/proxies.type.ts";
import { GeneralInternals } from "./general-internals.ts";

export const Reactivity: {
  "Render": {
    "active"     : (() => void) | undefined;
    "getUniqueId": () => string;
  };
  "Proxies"     : ProxiesType;
  "HTMLElements": Map<string, HTMLElement>;
} = {
  "Render": {
    "active"     : undefined,
    "getUniqueId": () => `deca-${GeneralInternals.uniqueId++}`,
  },
  "Proxies"     : new WeakMap,
  "HTMLElements": new Map,
};
