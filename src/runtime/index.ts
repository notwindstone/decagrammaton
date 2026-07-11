// Public runtime surface, imported by generated render modules and app code as
// "decagrammaton/runtime".
export { renderEffect, on, setText, mountStyle, setStyle, append, createContext, createProps, createIf, rootIf, isRootIf, createFor, rootFor, isRootFor, toModelNumber, modelArrayHas, modelArrayToggle } from "./helpers.ts";
export type { IfBranch, RootIfMarker, ForAliases, ForConfig, RootForMarker } from "./helpers.ts";
export { createApp, createComponent } from "./component.ts";
export type { ComponentModule, AppInstance } from "./component.ts";
export { provide, inject } from "./instance.ts";
export type { ComponentInstance } from "./instance.ts";
