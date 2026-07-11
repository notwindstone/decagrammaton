// DOM event name -> Ark element `on*` method. This is the runtime's OWN event
// allowlist: `on()` (helpers.ts) re-checks against it before calling any ark
// handler, so an event that slipped past the compiler still cannot reach an
// un-whitelisted method. It lives in the runtime (not compiler/tables.ts) so the
// shipped runtime bundle never has to pull in compiler code to hold its own
// allowlist. The compiler imports it from here for its build-time pre-check —
// build-time tooling importing a runtime constant is free (never bundled).
export const EVENT_METHODS: Record<string, string> = {
  click: "onClick", dblclick: "onDblClick",
  mousedown: "onMouseDown", mouseup: "onMouseUp",
  mouseenter: "onMouseEnter", mouseleave: "onMouseLeave", mousemove: "onMouseMove",
  pointerdown: "onPointerDown", pointerup: "onPointerUp", pointermove: "onPointerMove",
  contextmenu: "onContextMenu",
  keydown: "onKeyDown", keyup: "onKeyUp",
  focus: "onFocus", blur: "onBlur",
  touchstart: "onTouchStart", touchend: "onTouchEnd", touchmove: "onTouchMove",
  scroll: "onScroll",
  change: "onChange", input: "onInput",
};
