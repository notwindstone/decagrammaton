import type {
  SafeElement,
  SafeTextNode,
  SafeDocument,
  EventHandler,
  EventCleanup,
  HeadingLevel,
  FormattingTag,
} from "ark-of-atrahasis";
import { effect } from "alien-signals";
import type {
  TemplateNode,
  ElementNode,
  ConditionalNode,
  ForNode,
  Attribute,
} from "../compiler/parser.ts";
import type { ComponentDefinitionType } from "../types/component/component-definition.type.ts";

type CleanupFn = () => void;

const FORMATTING_TAGS = new Set<string>([
  "strong", "em", "small", "b", "i", "u",
  "code", "kbd", "samp", "var",
  "sub", "sup", "mark", "abbr", "cite",
]);

const TAG_CREATORS: Record<string, string> = {
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

const EVENT_METHODS: Record<string, string> = {
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

const cachedExpressionFunctions = new Map<string, Function>();

export function mount(
  nodes: Array<TemplateNode>,
  container: SafeElement,
  scope: Record<string, unknown>,
  gui: SafeDocument,
  components?: Record<string, ComponentDefinitionType>,
  context?: Record<string, unknown>,
): CleanupFn {
  const cleanups: Array<CleanupFn> = [];

  for (const node of nodes) {
    const cleanup = mountNode(node, container, scope, gui, components, context);
    if (cleanup) cleanups.push(cleanup);
  }

  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}

function mountNode(
  node: TemplateNode,
  parent: SafeElement,
  scope: Record<string, unknown>,
  gui: SafeDocument,
  components?: Record<string, ComponentDefinitionType>,
  context?: Record<string, unknown>,
): CleanupFn | null {
  switch (node.type) {
    case "element":
      return mountElement(node, parent, scope, gui, components, context);
    case "text":
      return mountText(node, parent, gui);
    case "expression":
      return mountExpression(node, parent, scope, gui);
    case "conditional":
      return mountConditional(node, parent, scope, gui, components, context);
    case "for":
      return mountFor(node, parent, scope, gui, components, context);
  }
}

function isComponentTag(tag: string): boolean {
  return tag[0] !== undefined && tag[0] === tag[0].toUpperCase();
}

function createElement(tag: string, gui: SafeDocument): SafeElement {
  if (/^h[1-6]$/.test(tag)) {
    return gui.createHeading(Number(tag[1]) as HeadingLevel);
  }

  if (FORMATTING_TAGS.has(tag)) {
    return gui.createFormatting(tag as FormattingTag);
  }

  if (tag === "ul") return gui.createList("unordered") as SafeElement;
  if (tag === "ol") return gui.createList("ordered") as SafeElement;
  if (tag === "dl") return gui.createList("description") as SafeElement;
  if (tag === "li" || tag === "dt" || tag === "dd") return gui.createDiv();

  const creator = TAG_CREATORS[tag];
  if (creator) {
    return (gui as unknown as Record<string, () => SafeElement>)[creator]!();
  }

  return gui.createDiv();
}

function mountElement(
  node: ElementNode,
  parent: SafeElement,
  scope: Record<string, unknown>,
  gui: SafeDocument,
  components?: Record<string, ComponentDefinitionType>,
  context?: Record<string, unknown>,
): CleanupFn | null {
  if (isComponentTag(node.tag)) {
    return mountComponent(node, parent, scope, gui, components, context);
  }

  const element = createElement(node.tag, gui);
  const cleanups: Array<CleanupFn> = [];

  const attrCleanups = applyAttributes(element, node.attributes, scope, gui);
  cleanups.push(...attrCleanups);

  for (const child of node.children) {
    const cleanup = mountNode(child, element, scope, gui, components, context);
    if (cleanup) cleanups.push(cleanup);
  }

  parent.appendChild(element);

  return () => {
    for (const cleanup of cleanups) cleanup();
    element.remove();
  };
}

function mountText(
  node: { value: string },
  parent: SafeElement,
  gui: SafeDocument,
): CleanupFn | null {
  const textNode = gui.createRawText();
  textNode.setText(node.value);
  parent.appendChild(textNode);

  return () => textNode.remove();
}

function mountComponent(
  node: ElementNode,
  parent: SafeElement,
  scope: Record<string, unknown>,
  gui: SafeDocument,
  components?: Record<string, ComponentDefinitionType>,
  context?: Record<string, unknown>,
): CleanupFn | null {
  const definition = (scope[node.tag] ?? components?.[node.tag]) as ComponentDefinitionType | undefined;

  if (!definition) return null;

  const props: Record<string, unknown> = {};

  for (const attr of node.attributes) {
    if (attr.type === "expression-attribute") {
      props[attr.name] = evaluateExpression(attr.value, scope);
    } else if (attr.type === "attribute") {
      props[attr.name] = attr.value;
    }
  }

  const parentContext = context ?? Object.create(null) as Record<string, unknown>;
  const childContext = Object.create(parentContext) as Record<string, unknown>;
  const provideFn = (key: string, value: unknown) => { childContext[key] = value; };
  const injectFn = (key: string) => parentContext[key];

  const componentScope = definition.factory(props, provideFn, injectFn);

  return mount(definition.template, parent, componentScope, gui, components, childContext);
}

function mountExpression(
  node: { value: string },
  parent: SafeElement,
  scope: Record<string, unknown>,
  gui: SafeDocument,
): CleanupFn {
  const textNode = gui.createRawText();
  parent.appendChild(textNode);

  const dispose = effect(() => {
    textNode.setText(String(evaluateExpression(node.value, scope) ?? ""));
  });

  return () => {
    dispose();
    textNode.remove();
  };
}

function mountConditional(
  node: ConditionalNode,
  parent: SafeElement,
  scope: Record<string, unknown>,
  gui: SafeDocument,
  components?: Record<string, ComponentDefinitionType>,
  context?: Record<string, unknown>,
): CleanupFn {
  const anchor = gui.createRawText();
  parent.appendChild(anchor);

  let currentCleanup: CleanupFn | null = null;
  let currentElements: Array<SafeElement | SafeTextNode> = [];

  const dispose = effect(() => {
    if (currentCleanup) {
      currentCleanup();
      for (const el of currentElements) {
        if ('remove' in el) el.remove();
      }
      currentCleanup = null;
      currentElements = [];
    }

    let matchedBranch: typeof node.branches[number] | null = null;

    for (const branch of node.branches) {
      if (branch.condition === null) {
        matchedBranch = branch;
        break;
      }

      if (evaluateExpression(branch.condition, scope)) {
        matchedBranch = branch;
        break;
      }
    }

    if (!matchedBranch) return;

    const wrapper = gui.createDiv();
    currentElements.push(wrapper);
    parent.insertBefore(wrapper, anchor);

    const cleanups: Array<CleanupFn> = [];
    for (const child of matchedBranch.children) {
      const cleanup = mountNode(child, wrapper, scope, gui, components, context);
      if (cleanup) cleanups.push(cleanup);
    }

    currentCleanup = () => {
      for (const c of cleanups) c();
    };

    return () => {
      if (currentCleanup) {
        currentCleanup();
        for (const el of currentElements) {
          if ('remove' in el) el.remove();
        }
        currentCleanup = null;
        currentElements = [];
      }
    };
  });

  return () => {
    dispose();
    if (currentCleanup) {
      currentCleanup();
      for (const el of currentElements) {
        if ('remove' in el) el.remove();
      }
    }
    anchor.remove();
  };
}

function mountFor(
  node: ForNode,
  parent: SafeElement,
  scope: Record<string, unknown>,
  gui: SafeDocument,
  components?: Record<string, ComponentDefinitionType>,
  context?: Record<string, unknown>,
): CleanupFn {
  const anchor = gui.createRawText();
  parent.appendChild(anchor);

  const keyMap = new Map<unknown, { wrapper: SafeElement; cleanup: CleanupFn }>();

  const dispose = effect(() => {
    const items = evaluateExpression(node.iterable, scope) as Array<unknown> | undefined;

    if (!items || !Array.isArray(items)) return;

    const newKeys = new Set<unknown>();
    const bindingMatch = node.binding.match(/^\(?\s*(\w+)\s*(?:,\s*(\w+))?\s*\)?$/);

    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      const itemScope = { ...scope };

      if (bindingMatch) {
        itemScope[bindingMatch[1]!] = item;
        if (bindingMatch[2]) {
          itemScope[bindingMatch[2]] = index;
        }
      }

      const key = evaluateExpression(node.key, itemScope);
      newKeys.add(key);

      if (!keyMap.has(key)) {
        const wrapper = gui.createDiv();
        const cleanups: Array<CleanupFn> = [];

        for (const child of node.children) {
          const cleanup = mountNode(child, wrapper, itemScope, gui, components, context);
          if (cleanup) cleanups.push(cleanup);
        }

        parent.insertBefore(wrapper, anchor);
        keyMap.set(key, {
          wrapper,
          cleanup: () => { for (const c of cleanups) c(); },
        });
      }
    }

    for (const [key, entry] of keyMap) {
      if (!newKeys.has(key)) {
        entry.cleanup();
        entry.wrapper.remove();
        keyMap.delete(key);
      }
    }

    return () => {
      for (const [, entry] of keyMap) {
        entry.cleanup();
        entry.wrapper.remove();
      }
      keyMap.clear();
    };
  });

  return () => {
    dispose();
    for (const [, entry] of keyMap) {
      entry.cleanup();
      entry.wrapper.remove();
    }
    keyMap.clear();
    anchor.remove();
  };
}

function applyAttributes(
  element: SafeElement,
  attributes: Array<Attribute>,
  scope: Record<string, unknown>,
  _gui: SafeDocument,
): Array<CleanupFn> {
  const cleanups: Array<CleanupFn> = [];

  for (const attr of attributes) {
    switch (attr.type) {
      case "attribute": {
        const value = attr.value === true ? "" : attr.value;
        applyStaticAttribute(element, attr.name, value);
        break;
      }
      case "expression-attribute": {
        if (attr.name.startsWith("@")) {
          const eventName = attr.name.slice(1);
          const handler = evaluateExpression(attr.value, scope);

          if (typeof handler === "function") {
            const cleanup = applyEvent(element, eventName, handler as EventHandler);
            if (cleanup) cleanups.push(cleanup);
          }

          break;
        }

        if (attr.name === "style") {
          const dispose = effect(() => {
            const result = evaluateExpression(attr.value, scope);

            if (typeof result === "object" && result !== null) {
              for (const [key, value] of Object.entries(result)) {
                element.style[key] = String(value ?? "");
              }
            }
          });
          cleanups.push(dispose);
          break;
        }

        const dispose = effect(() => {
          const result = evaluateExpression(attr.value, scope);
          applyStaticAttribute(element, attr.name, result);
        });
        cleanups.push(dispose);
        break;
      }
    }
  }

  return cleanups;
}

function applyStaticAttribute(element: SafeElement, name: string, value: unknown): void {
  const str = String(value ?? "");
  const el = element as unknown as Record<string, unknown>;

  switch (name) {
    case "class": element.setClass(str); break;
    case "id": element.setId(str); break;
    case "title": element.setTitle(str); break;
    case "role": element.setRole(str); break;
    case "tabindex": element.setTabIndex(Number(value) | 0); break;
    case "hidden": element.setHidden(!!value); break;
    case "lang": element.setLang(str); break;
    case "dir": element.setDir(str); break;
    case "spellcheck": element.setSpellcheck(!!value); break;
    case "disabled":
      if (typeof el["setDisabled"] === "function") (el["setDisabled"] as (v: boolean) => void)(!!value);
      break;
    case "type":
      if (typeof el["setType"] === "function") (el["setType"] as (v: string) => void)(str);
      break;
    case "value":
      if (typeof el["setValue"] === "function") (el["setValue"] as (v: string) => void)(str);
      break;
    case "placeholder":
      if (typeof el["setPlaceholder"] === "function") (el["setPlaceholder"] as (v: string) => void)(str);
      break;
    case "src":
      if (typeof el["setSrc"] === "function") (el["setSrc"] as (v: string) => void)(str);
      break;
    case "alt":
      if (typeof el["setAlt"] === "function") (el["setAlt"] as (v: string) => void)(str);
      break;
    case "href":
      if (typeof el["setHref"] === "function") (el["setHref"] as (v: string) => void)(str);
      break;
    case "for":
      if (typeof el["setFor"] === "function") (el["setFor"] as (v: string) => void)(str);
      break;
    case "name":
      if (typeof el["setName"] === "function") (el["setName"] as (v: string) => void)(str);
      break;
    case "checked":
      if (typeof el["setChecked"] === "function") (el["setChecked"] as (v: boolean) => void)(!!value);
      break;
    case "selected":
      if (typeof el["setSelected"] === "function") (el["setSelected"] as (v: boolean) => void)(!!value);
      break;
    case "required":
      if (typeof el["setRequired"] === "function") (el["setRequired"] as (v: boolean) => void)(!!value);
      break;
    case "readonly":
      if (typeof el["setReadonly"] === "function") (el["setReadonly"] as (v: boolean) => void)(!!value);
      break;
    case "min":
      if (typeof el["setMin"] === "function") (el["setMin"] as (v: string) => void)(str);
      break;
    case "max":
      if (typeof el["setMax"] === "function") (el["setMax"] as (v: string) => void)(str);
      break;
    case "step":
      if (typeof el["setStep"] === "function") (el["setStep"] as (v: string) => void)(str);
      break;
    case "rows":
      if (typeof el["setRows"] === "function") (el["setRows"] as (v: number) => void)(Number(value) | 0);
      break;
    case "cols":
      if (typeof el["setCols"] === "function") (el["setCols"] as (v: number) => void)(Number(value) | 0);
      break;
    case "colspan":
      if (typeof el["setColspan"] === "function") (el["setColspan"] as (v: number) => void)(Number(value) | 0);
      break;
    case "rowspan":
      if (typeof el["setRowspan"] === "function") (el["setRowspan"] as (v: number) => void)(Number(value) | 0);
      break;
    case "width":
      if (typeof el["setWidth"] === "function") (el["setWidth"] as (v: number) => void)(Number(value) | 0);
      break;
    case "height":
      if (typeof el["setHeight"] === "function") (el["setHeight"] as (v: number) => void)(Number(value) | 0);
      break;
    case "loading":
      if (typeof el["setLoading"] === "function") (el["setLoading"] as (v: string) => void)(str);
      break;
    case "open":
      if (typeof el["setOpen"] === "function") (el["setOpen"] as (v: boolean) => void)(!!value);
      break;
    case "controls":
      if (typeof el["setControls"] === "function") (el["setControls"] as (v: boolean) => void)(!!value);
      break;
    case "autoplay":
      if (typeof el["setAutoplay"] === "function") (el["setAutoplay"] as (v: boolean) => void)(!!value);
      break;
    case "loop":
      if (typeof el["setLoop"] === "function") (el["setLoop"] as (v: boolean) => void)(!!value);
      break;
    case "muted":
      if (typeof el["setMuted"] === "function") (el["setMuted"] as (v: boolean) => void)(!!value);
      break;
    case "poster":
      if (typeof el["setPoster"] === "function") (el["setPoster"] as (v: string) => void)(str);
      break;
    case "multiple":
      if (typeof el["setMultiple"] === "function") (el["setMultiple"] as (v: boolean) => void)(!!value);
      break;
    case "pattern":
      if (typeof el["setPattern"] === "function") (el["setPattern"] as (v: string) => void)(str);
      break;
    case "autocomplete":
      if (typeof el["setAutocomplete"] === "function") (el["setAutocomplete"] as (v: string) => void)(str);
      break;
    case "autofocus":
      if (typeof el["setAutofocus"] === "function") (el["setAutofocus"] as (v: boolean) => void)(!!value);
      break;
    case "inputmode":
      if (typeof el["setInputMode"] === "function") (el["setInputMode"] as (v: string) => void)(str);
      break;
    case "enterkeyhint":
      if (typeof el["setEnterKeyHint"] === "function") (el["setEnterKeyHint"] as (v: string) => void)(str);
      break;
    case "minlength":
      if (typeof el["setMinLength"] === "function") (el["setMinLength"] as (v: number) => void)(Number(value) | 0);
      break;
    case "maxlength":
      if (typeof el["setMaxLength"] === "function") (el["setMaxLength"] as (v: number) => void)(Number(value) | 0);
      break;
    case "wrap":
      if (typeof el["setWrap"] === "function") (el["setWrap"] as (v: string) => void)(str);
      break;
    case "scope":
      if (typeof el["setScope"] === "function") (el["setScope"] as (v: string) => void)(str);
      break;
    case "headers":
      if (typeof el["setHeaders"] === "function") (el["setHeaders"] as (v: string) => void)(str);
      break;
    case "label":
      if (typeof el["setLabel"] === "function") (el["setLabel"] as (v: string) => void)(str);
      break;
    default:
      if (name.startsWith("data-")) element.setData(name.slice(5), str);
      else if (name.startsWith("aria-")) element.setAria(name.slice(5), str);
      break;
  }
}

function applyEvent(element: SafeElement, eventName: string, handler: EventHandler): CleanupFn | null {
  const methodName = EVENT_METHODS[eventName];
  if (!methodName) return null;

  const el = element as unknown as Record<string, (handler: EventHandler) => EventCleanup>;
  const method = el[methodName];
  if (typeof method !== "function") return null;

  return method.call(element, handler);
}

function evaluateExpression(expression: string, scope: Record<string, unknown>): unknown {
  const keys = Object.keys(scope);
  const values = Object.values(scope);
  const cachedKey = keys.join("-") + "-" + expression;
  let evaluate = cachedExpressionFunctions.get(cachedKey);

  if (!evaluate) {
    evaluate = new Function(...keys, `return (${expression});`);
    cachedExpressionFunctions.set(cachedKey, evaluate);
  }

  return evaluate(...values);
}
