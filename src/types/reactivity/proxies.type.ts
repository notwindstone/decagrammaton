import type { StateType } from "./state.type.ts";
import type { MappingsType } from "./mappings.type.ts";

export type ProxiesType = WeakMap<
  StateType<unknown>,
  MappingsType
>;