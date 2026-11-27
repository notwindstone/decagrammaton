import {
  FACTORY_TAGS,
  FORMATTING_TAGS,
  LIST_TYPES,
  PUBLIC_EVENT_CATALOG,
  isAttrKeySafe,
  isInputTypeAllowed,
  isButtonTypeAllowed,
  isValidMimeType,
} from "ark-of-atrahasis/validators";
import { DecaCompileError } from "./errors.ts";

const creators = new Map<string, string>(
  Object.entries(FACTORY_TAGS).map(([method, tag]) => [tag, method + "()"]),
);
for (const tag of FORMATTING_TAGS) creators.set(tag, `createFormatting("${tag}")`);
const lists = { ordered: "ol", unordered: "ul", description: "dl" };
for (const type of LIST_TYPES) creators.set(lists[type], `createList("${type}")`);
for (let i = 1; i <= 6; i++) creators.set("h" + i, `createHeading(${i})`);
export { creators };
export const events = new Set<string>(Object.values(PUBLIC_EVENT_CATALOG).map((event) => event.type));
export const voidTags = new Set("input img br hr wbr col source track".split(" "));

type Kind = "string" | "boolean" | "integer" | "number";
interface Setter {
  method: string;
  kind: Kind;
  key?: string;
  min?: number;
  max?: number;
}
const setters = new Map<string, Setter>();
function register(tags: string, names: string, kind: Kind = "string", min?: number, max?: number) {
  for (const tag of tags.split(" "))
    for (const name of names.split(" ")) {
      setters.set(tag + "." + name.toLowerCase(), {
        kind,
        method: "set" + name[0].toUpperCase() + name.slice(1),
        min,
        max,
      });
    }
}
register("*", "id title role lang dir");
register("*", "hidden spellcheck", "boolean");
register("*", "tabIndex", "integer", -2147483648, 2147483647);
register("input textarea select", "autocomplete");
register("input textarea select option button output", "value");
register("input textarea select button output", "name");
register("input textarea", "placeholder");
register("input textarea", "minLength maxLength", "integer", 0, 2147483647);
register("input textarea", "readonly", "boolean");
register("input textarea select", "required", "boolean");
register("input select", "multiple", "boolean");
register("input textarea select option optgroup button fieldset", "disabled", "boolean");
register("input", "min max step pattern inputMode enterKeyHint");
register("input", "checked autofocus", "boolean");
register("input button source", "type");
register("textarea", "rows cols", "integer", 1, 2147483647);
register("textarea", "wrap");
register("option", "selected", "boolean");
register("option optgroup track", "label");
register("label output", "for");
register("a", "href");
register("img video audio source track", "src");
register("img", "loading alt");
register("img video canvas", "width height", "integer", 0, 2147483647);
register("audio video", "controls autoplay loop muted", "boolean");
register("video", "poster");
register("track", "kind srclang");
register("track", "default", "boolean");
register("td th", "colspan", "integer", 1, 1000);
register("td th", "rowspan", "integer", 0, 65534);
register("td th", "headers");
register("th", "scope");
register("dialog details", "open", "boolean");
register("meter progress", "max value", "number");
register("meter", "low high optimum min", "number");

export function setter(tag: string, attr: string): Setter {
  const name = attr.toLowerCase();
  if (/^(aria|data)-/.test(name) && attr === name && isAttrKeySafe(name.slice(5))) {
    return {
      method: name.startsWith("aria-") ? "setAria" : "setData",
      kind: "string",
      key: name.slice(5),
    };
  }
  const entry = setters.get(tag + "." + name) ?? setters.get("*." + name);
  if (!entry) throw new DecaCompileError(`Unknown attribute "${attr}" on <${tag}>.`);
  return entry;
}
export function literal(tag: string, name: string, entry: Setter, raw: string | null) {
  const value = raw ?? "";
  function invalid(): never {
    throw new DecaCompileError(`Invalid ${name} on <${tag}>: ${JSON.stringify(raw)}`);
  }
  if (entry.kind === "boolean") {
    if (name === "autofocus") invalid();
    if (name === "spellcheck") {
      if (!["", "true", "false"].includes(value.toLowerCase())) invalid();
      return value.toLowerCase() !== "false";
    }
    return true;
  }
  if (entry.kind !== "string") {
    const numeric =
      entry.kind === "integer" ? /^[+-]?\d+$/ : /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
    if (!numeric.test(value.trim())) invalid();
    const n = Number(value);
    if (
      !Number.isFinite(n) ||
      (entry.kind === "integer" && (!Number.isInteger(n) || n < entry.min! || n > entry.max!))
    )
      invalid();
    return n;
  }
  if (name === "autocomplete" && value !== "off") invalid();
  if (name === "type") {
    if (tag === "source") {
      if (!isValidMimeType(value)) invalid();
    } else {
      const type = value.toLowerCase();
      if (!(tag === "input" ? isInputTypeAllowed(type) : isButtonTypeAllowed(type))) invalid();
      return type;
    }
  }
  return value;
}
