export interface SafeEventType {
  type: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  targetId: string;
  targetValue: unknown;
  currentTargetId: string;
  currentTargetValue: unknown;
  preventDefault(): void;
  stopPropagation(): void;
  stopImmediatePropagation(): void;
  setTargetValue(input: string | number | boolean): void;
  setCurrentTargetValue(input: string | number | boolean): void;
}

export interface SafeElement {
  __id: string;
  setAttribute(name: string, value: string): void;
  appendChild(child: SafeElement | SafeText): void;
  remove(): void;
  addEventListener(event: string, handler: (safeEvent: SafeEventType) => void): void;
  style: Record<string, string>;
}

export interface SafeText {
  __id: string;
  textContent: string;
  remove(): void;
}

const ALLOWED_TAGS = new Set([
  "div", "span", "p", "a", "b", "i", "u", "em", "strong", "small", "sub", "sup",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "dl", "dt", "dd",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
  "input", "button", "select", "option", "optgroup", "textarea", "label", "fieldset", "legend",
  "img", "picture", "source", "video", "audio", "track", "canvas",
  "details", "summary", "dialog",
  "nav", "main", "header", "footer", "section", "article", "aside",
  "figure", "figcaption", "blockquote", "pre", "code", "kbd", "samp", "var",
  "hr", "br", "wbr",
  "abbr", "cite", "data", "time", "mark", "ruby", "rt", "rp",
  "progress", "meter", "output",
]);

const ALLOWED_ATTRIBUTES = new Set([
  "class", "id", "title", "lang", "dir", "tabindex", "role", "hidden",
  "type", "name", "value", "placeholder", "disabled", "readonly", "required",
  "checked", "selected", "multiple", "min", "max", "step", "minlength", "maxlength",
  "pattern", "autocomplete", "autofocus", "for", "rows", "cols", "wrap",
  "alt", "width", "height", "loading",
  "open", "colspan", "rowspan", "scope", "headers",
  "spellcheck", "inputmode", "enterkeyhint",
]);

const ALLOWED_DATA_OR_ARIA_PATTERN = /^(data-|aria-)/;

const ALLOWED_STYLE_PROPERTIES = new Set([
  "color", "opacity",
  "background-color", "backgroundColor",
  "font-size", "fontSize", "font-weight", "fontWeight",
  "font-style", "fontStyle", "font-family", "fontFamily",
  "font-variant", "fontVariant",
  "text-align", "textAlign", "text-decoration", "textDecoration",
  "text-transform", "textTransform", "text-indent", "textIndent",
  "text-overflow", "textOverflow",
  "letter-spacing", "letterSpacing", "word-spacing", "wordSpacing",
  "line-height", "lineHeight", "white-space", "whiteSpace",
  "vertical-align", "verticalAlign",
  "margin-top", "marginTop", "margin-right", "marginRight",
  "margin-bottom", "marginBottom", "margin-left", "marginLeft",
  "padding-top", "paddingTop", "padding-right", "paddingRight",
  "padding-bottom", "paddingBottom", "padding-left", "paddingLeft",
  "border-width", "borderWidth",
  "border-top-width", "borderTopWidth", "border-right-width", "borderRightWidth",
  "border-bottom-width", "borderBottomWidth", "border-left-width", "borderLeftWidth",
  "border-color", "borderColor",
  "border-top-color", "borderTopColor", "border-right-color", "borderRightColor",
  "border-bottom-color", "borderBottomColor", "border-left-color", "borderLeftColor",
  "border-style", "borderStyle",
  "border-top-style", "borderTopStyle", "border-right-style", "borderRightStyle",
  "border-bottom-style", "borderBottomStyle", "border-left-style", "borderLeftStyle",
  "border-radius", "borderRadius",
  "border-top-left-radius", "borderTopLeftRadius",
  "border-top-right-radius", "borderTopRightRadius",
  "border-bottom-left-radius", "borderBottomLeftRadius",
  "border-bottom-right-radius", "borderBottomRightRadius",
  "width", "min-width", "minWidth", "max-width", "maxWidth",
  "height", "min-height", "minHeight", "max-height", "maxHeight",
  "display", "visibility",
  "overflow", "overflow-x", "overflowX", "overflow-y", "overflowY",
  "position", "top", "right", "bottom", "left",
  "z-index", "zIndex",
  "flex-direction", "flexDirection", "flex-wrap", "flexWrap",
  "flex-grow", "flexGrow", "flex-shrink", "flexShrink", "flex-basis", "flexBasis",
  "align-items", "alignItems", "align-self", "alignSelf",
  "justify-content", "justifyContent", "justify-self", "justifySelf",
  "gap", "row-gap", "rowGap", "column-gap", "columnGap",
  "grid-template-columns", "gridTemplateColumns",
  "grid-template-rows", "gridTemplateRows",
  "grid-column", "gridColumn", "grid-row", "gridRow",
  "order",
  "box-shadow", "boxShadow",
  "outline-color", "outlineColor", "outline-style", "outlineStyle",
  "outline-width", "outlineWidth", "outline-offset", "outlineOffset",
  "transform", "transition",
  "animation-name", "animationName", "animation-duration", "animationDuration",
  "animation-timing-function", "animationTimingFunction",
  "animation-delay", "animationDelay", "animation-iteration-count", "animationIterationCount",
  "animation-direction", "animationDirection", "animation-fill-mode", "animationFillMode",
  "user-select", "userSelect", "pointer-events", "pointerEvents",
  "resize", "appearance",
  "object-fit", "objectFit", "object-position", "objectPosition",
  "aspect-ratio", "aspectRatio",
  "word-break", "wordBreak", "overflow-wrap", "overflowWrap", "hyphens",
  "accent-color", "accentColor", "caret-color", "caretColor",
  "column-count", "columnCount", "column-gap", "columnGap",
  "scroll-behavior", "scrollBehavior",
  "scroll-margin-top", "scrollMarginTop", "scroll-margin-bottom", "scrollMarginBottom",
  "scroll-padding-top", "scrollPaddingTop", "scroll-padding-bottom", "scrollPaddingBottom",
  "touch-action", "touchAction",
  "will-change", "willChange",
  "isolation",
  "mix-blend-mode", "mixBlendMode",
  "clip-path", "clipPath",
  "contain", "container-type", "containerType",
]);

const URL_PATTERN = /url\s*\(|(-webkit-)?image-set\s*\(/i;

const wrapperByRealNode = new WeakMap<Element | Text, SafeElement | SafeText>();
const realNodeByWrapper = new WeakMap<SafeElement | SafeText, Element | Text>();

function getTargetProp(target: EventTarget | null, prop: string): unknown {
  if (target === null || !(prop in target)) return undefined;
  return (target as unknown as Record<string, unknown>)[prop];
}

function assertPrimitiveInput(input: unknown): asserts input is string | number | boolean {
  if (typeof input !== "string" && typeof input !== "number" && typeof input !== "boolean") {
    throw new Error("Invalid input: expected string, number, or boolean");
  }
}

function createSafeEvent(nativeEvent: Event, _wrapper: SafeElement): SafeEventType {
  return Object.freeze({
    type: nativeEvent.type,
    ctrlKey: (nativeEvent as KeyboardEvent).ctrlKey ?? false,
    altKey: (nativeEvent as KeyboardEvent).altKey ?? false,
    shiftKey: (nativeEvent as KeyboardEvent).shiftKey ?? false,
    metaKey: (nativeEvent as KeyboardEvent).metaKey ?? false,
    targetId: String(getTargetProp(nativeEvent.target, "id") ?? ""),
    targetValue: getTargetProp(nativeEvent.target, "value"),
    currentTargetId: String(getTargetProp(nativeEvent.currentTarget, "id") ?? ""),
    currentTargetValue: getTargetProp(nativeEvent.currentTarget, "value"),
    preventDefault: () => nativeEvent.preventDefault(),
    stopPropagation: () => nativeEvent.stopPropagation(),
    stopImmediatePropagation: () => nativeEvent.stopImmediatePropagation(),
    setTargetValue(input: string | number | boolean) {
      assertPrimitiveInput(input);
      if (nativeEvent.target !== null && "value" in nativeEvent.target) {
        (nativeEvent.target as HTMLInputElement).value = String(input);
      }
    },
    setCurrentTargetValue(input: string | number | boolean) {
      assertPrimitiveInput(input);
      if (nativeEvent.currentTarget !== null && "value" in nativeEvent.currentTarget) {
        (nativeEvent.currentTarget as HTMLInputElement).value = String(input);
      }
    },
  });
}

function createSafeElement(realEl: Element): SafeElement {
  const existing = wrapperByRealNode.get(realEl);
  if (existing) return existing as SafeElement;

  const style = new Proxy(Object.create(null) as Record<string, string>, {
    get(_, prop) {
      if (typeof prop !== "string") return undefined;
      if (!ALLOWED_STYLE_PROPERTIES.has(prop)) return undefined;
      return (realEl as HTMLElement).style[prop as any];
    },
    set(_, prop, value) {
      if (typeof prop !== "string") return false;
      if (!ALLOWED_STYLE_PROPERTIES.has(prop)) return false;

      const stringValue = String(value ?? "");
      if (URL_PATTERN.test(stringValue)) return false;

      (realEl as HTMLElement).style[prop as any] = stringValue;
      return true;
    },
  });

  const wrapper: SafeElement = {
    __id: "",
    setAttribute(name: string, value: string) {
      const lowerName = name.toLowerCase();

      if (!ALLOWED_ATTRIBUTES.has(lowerName) && !ALLOWED_DATA_OR_ARIA_PATTERN.test(lowerName)) return;

      realEl.setAttribute(name, value);
    },
    appendChild(child: SafeElement | SafeText) {
      const realChild = realNodeByWrapper.get(child);
      if (!realChild) return;
      realEl.appendChild(realChild);
    },
    remove() {
      realEl.remove();
      wrapperByRealNode.delete(realEl);
      realNodeByWrapper.delete(wrapper);
    },
    addEventListener(event: string, handler: (safeEvent: SafeEventType) => void) {
      realEl.addEventListener(event, (nativeEvent: Event) => {
        handler(createSafeEvent(nativeEvent, wrapper));
      });
    },
    style,
  };

  wrapperByRealNode.set(realEl, wrapper);
  realNodeByWrapper.set(wrapper, realEl);

  return wrapper;
}

function createSafeText(realText: Text): SafeText {
  const existing = wrapperByRealNode.get(realText);
  if (existing) return existing as SafeText;

  const wrapper: SafeText = {
    __id: "",
    set textContent(value: string) {
      realText.textContent = String(value ?? "");
    },
    remove() {
      realText.remove();
      wrapperByRealNode.delete(realText);
      realNodeByWrapper.delete(wrapper);
    },
  };

  wrapperByRealNode.set(realText, wrapper);
  realNodeByWrapper.set(wrapper, realText);

  return wrapper;
}

export function createSafeDocument(pluginRoot: HTMLElement) {
  return {
    createElement(tag: string): SafeElement {
      const lowerTag = tag.toLowerCase();

      if (!ALLOWED_TAGS.has(lowerTag)) {
        throw new Error(`Blocked tag: <${tag}>`);
      }

      if (lowerTag.includes("-")) {
        throw new Error(`Custom elements are not allowed: <${tag}>`);
      }

      const realEl = document.createElement(lowerTag);
      return createSafeElement(realEl);
    },
    createTextNode(text: string): SafeText {
      const realText = document.createTextNode(text);
      return createSafeText(realText);
    },
    getElementById(id: string): SafeElement | null {
      if (pluginRoot.id === id) return createSafeElement(pluginRoot);

      const realEl = pluginRoot.querySelector(`#${CSS.escape(id)}`);
      if (!realEl || !(realEl instanceof HTMLElement)) return null;
      return createSafeElement(realEl);
    },
  };
}
