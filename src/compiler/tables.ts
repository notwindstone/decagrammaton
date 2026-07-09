// Build-time lookup tables: the surviving "good parts" of the old runtime
// render.ts, kept as DATA (per the rewrite plan). Codegen resolves each tag /
// event against these at build time. A tag or event with no entry has no Ark
// method — codegen throws, which is exactly the whitelist-by-construction
// security property.
//
// Source of truth for the method names is ark-of-atrahasis' surface.

// Tags created by a dedicated `gui.create*()` method.
export const TAG_CREATORS: Record<string, string> = {
  div: "createDiv", span: "createSpan", section: "createSection",
  article: "createArticle", nav: "createNav", header: "createHeader",
  footer: "createFooter", main: "createMain", aside: "createAside",
  figure: "createFigure", figcaption: "createFigcaption",
  p: "createText", blockquote: "createBlockquote", pre: "createPre",
  table: "createTable", thead: "createThead", tbody: "createTbody",
  tfoot: "createTfoot", tr: "createTr", th: "createTh", td: "createTd",
  caption: "createCaption", colgroup: "createColgroup", col: "createCol",
  button: "createButton", input: "createInput", select: "createSelect",
  option: "createOption", optgroup: "createOptgroup",
  textarea: "createTextarea", label: "createLabel",
  fieldset: "createFieldset", legend: "createLegend",
  img: "createImage", video: "createVideo", audio: "createAudio",
  source: "createSource", track: "createTrack", picture: "createPicture",
  canvas: "createCanvas",
  a: "createAnchor", details: "createDetails", summary: "createSummary",
  dialog: "createDialog", hr: "createHr", br: "createBr", wbr: "createWbr",
  progress: "createProgress", meter: "createMeter",
  output: "createOutput", time: "createTime", data: "createData",
  ruby: "createRuby", rt: "createRt", rp: "createRp",
};

// Inline formatting tags created via `gui.createFormatting(tag)`.
export const FORMATTING_TAGS = new Set<string>([
  "strong", "em", "small", "b", "i", "u",
  "code", "kbd", "samp", "var",
  "sub", "sup", "mark", "abbr", "cite",
]);

// DOM event name -> Ark element `on*` method.
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
