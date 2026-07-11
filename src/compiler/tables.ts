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
  li: "createListItem", dt: "createTerm", dd: "createDescription",
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

// HTML/template attribute name -> Ark element setter method (slice 5).
//
// FLAT table, no per-tag validation (architect decision A): the key is the attr
// name and the value is the ark setter, resolved WITHOUT checking whether that
// setter is valid on the specific tag. `:href` on a <div> emits `div.setHref(…)`
// and is allowed to fail/no-op at runtime — ark's own types are the backstop.
// An attr with NO entry here has no whitelisted setter and codegen THROWS: that
// build-time throw IS the whitelist (there is no generic setAttribute).
//
// Keys are LOWERCASE. baseParse preserves the author's attr-name casing (probe-
// confirmed: `:maxLength` arrives as "maxLength", `TabIndex` as "TabIndex"), so
// codegen lowercases once before lookup — HTML attributes are case-insensitive,
// lowercase is their canonical form. Setter names are ark's camelCase.
//
// `data-*` / `aria-*` are NOT in this table: they use the two-arg
// `setData(key, value)` / `setAria(key, value)` and are special-cased by prefix
// in codegen. Every setter below is one-arg.
export const ATTR_SETTERS: Record<string, string> = {
  // Common — on SafeElement, valid on every element. `style` is NOT here: it is
  // not a one-arg setter (elements have no cssText sink; `setCSS` belongs to a
  // <style> element). codegen special-cases `style`/`:style` to the setStyle
  // runtime helper, which writes element.style's per-property allowlist proxy.
  class: "setClass", id: "setId", title: "setTitle", role: "setRole",
  tabindex: "setTabIndex", hidden: "setHidden", lang: "setLang", dir: "setDir",
  spellcheck: "setSpellcheck",

  // Per-element (flat-merged; where an attr name recurs across elements it maps
  // to the same setter, so there is no conflict — one entry each).
  // input:
  type: "setType", value: "setValue", placeholder: "setPlaceholder",
  disabled: "setDisabled", readonly: "setReadonly", required: "setRequired",
  checked: "setChecked", min: "setMin", max: "setMax", step: "setStep",
  minlength: "setMinLength", maxlength: "setMaxLength", pattern: "setPattern",
  autocomplete: "setAutocomplete", autofocus: "setAutofocus", name: "setName",
  inputmode: "setInputMode", enterkeyhint: "setEnterKeyHint",
  // textarea adds:
  rows: "setRows", cols: "setCols", wrap: "setWrap",
  // select / option:
  multiple: "setMultiple", selected: "setSelected", label: "setLabel",
  // label:
  for: "setFor",
  // img:
  src: "setSrc", alt: "setAlt", width: "setWidth", height: "setHeight",
  loading: "setLoading",
  // anchor:
  href: "setHref",
  // video / audio:
  controls: "setControls", autoplay: "setAutoplay", loop: "setLoop",
  muted: "setMuted", poster: "setPoster",
  // table-cell:
  colspan: "setColspan", rowspan: "setRowspan", scope: "setScope",
  headers: "setHeaders",
  // details / dialog:
  open: "setOpen",
};

// EVENT_METHODS moved to ../runtime/event-methods.ts — it is the runtime's own
// event allowlist (re-checked by `on()` at runtime), so it lives with the
// runtime to keep the shipped runtime bundle from depending on compiler code.
// Codegen imports it from there for its build-time pre-check.
export { EVENT_METHODS } from "../runtime/event-methods.ts";
