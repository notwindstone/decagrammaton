import type { ProxiesType } from "../types/reactivity/proxies.type.ts";

export const Reactivity: {
  "Render": {
    "active": (() => void) | undefined;
  };
  "Proxies": ProxiesType;
} = {
  "Render": {
    "active": (): void => {},
  },
  "Proxies": new WeakMap,
};