import { DecaCompileError } from "../errors.ts";
import { creators, events, setter, literal } from "../tables.ts";
import { rewriteExpression, rewriteHandler, rewriteModelTarget, type PropAlias, forValueLocals } from "./expression.ts";
import type { IRNode, IRElement, IRFor, IRIf, IRModel, IRComponent } from "./ir.ts";

interface Ctx {
  contextNames: ReadonlySet<string>;
  bindings: object;
  aliases: ReadonlyMap<string, PropAlias>;
  lines: string[];
  counter: number;
  use(name: string): string;
}
export function generate(
  nodes: IRNode[],
  styles: string[] = [],
  use = (s: string) => s,
  render = "render",
  bindings: Record<string, unknown> = {},
  aliases: Record<string, string> = {},
) {
  const ctx: Ctx = { contextNames: new Set(Object.keys(bindings).filter(name => name !== "__propsAliases")), lines: [], counter: 0, use, bindings, aliases: new Map(Object.entries(aliases).map(([name, key]) => [name, { key, fromProps: bindings[key] !== "props" }])) };
  const ids = render + "_styles";
  const declarations = styles.length ? `const ${ids} = [${styles.map(() => "{}").join(", ")}];\n` : "";
  styles.forEach((css, i) =>
    ctx.lines.push(`${use("mountStyle")}(gui, ${JSON.stringify(css)}, ${ids}[${i}]);`),
  );
  const body = children(nodes, ctx);
  return declarations + `export function ${render}(_ctx, gui, parent, before, $slots${ctx.aliases.size ? ", $props" : ""}) {\n${body}\n}`;
}
function value(expression: string, ctx: Ctx, locals?: Set<string>) {
  return "(" + rewriteExpression(expression, locals, ctx.aliases, ctx.contextNames) + ")";
}
function children(nodes: IRNode[], ctx: Ctx) {
  const roots = nodes.map((node) => emit(node, ctx, "parent", "before"));
  ctx.lines.push(`return ${ctx.use("group")}([${roots.join(", ")}]);`);
  return ctx.lines.join("\n");
}
function factory(nodes: IRNode[], outer: Ctx, row = false) {
  const ctx = { ...outer, lines: [] as string[] };
  return `(${row ? "_ctx, " : ""}parent, before) => {\n${children(nodes, ctx)}\n}`;
}
function emit(node: IRNode, ctx: Ctx, parent: string, before?: string): string {
  try {
    return emitNode(node, ctx, parent, before);
  } catch (error) {
    if (error instanceof DecaCompileError && !error.loc) {
      error.loc = node.loc;
      error.message += ` at ${node.loc.start.line}:${node.loc.start.column}`;
    }
    throw error;
  }
}
function emitNode(node: IRNode, ctx: Ctx, parent: string, before?: string): string {
  const name = `n${ctx.counter++}`;
  const pos = before ? `${parent}, ${before}` : parent;
  const anchored = before ? pos : `${parent}, void 0`;
  const block = name + "Block";
  function result(expr: string) {
    ctx.lines.push((parent === "parent" ? `const ${block} = ` : "") + expr + ";");
    return block;
  }
  if (node.kind === "component") {
    const camel = camelizeProp(node.tag);
    const pascal = camel[0].toUpperCase() + camel.slice(1);
    const binding = [node.tag, camel, pascal].find((key) => Object.hasOwn(ctx.bindings, key));
    if (!binding && /^[a-z]/.test(node.tag)) throw new DecaCompileError(`Unknown tag <${node.tag}>.`);
    const slots = node.slot ? `, { default: ${factory(node.slot, ctx)} }` : "";
    return result(
      `${ctx.use("createComponent")}(${rewriteExpression(binding ?? node.tag, undefined, ctx.aliases, ctx.contextNames)}, ${genProps(node.props, ctx)}, gui, ${slots ? anchored : pos}${slots})`,
    );
  }
  if (node.kind === "slot")
    return result(`${ctx.use("mountSlot")}(${anchored}, $slots, ${factory(node.fallback, ctx)})`);
  const creator =
    node.kind === "element"
      ? creators.get(node.tag)
      : node.kind === "text"
        ? `createTextNode(${JSON.stringify(node.value)})`
        : "createTextNode()";
  if (!creator) throw new DecaCompileError(`Unknown tag <${(node as IRElement).tag}>.`);
  ctx.lines.push(`const ${name} = gui.${creator};`);
  const place = `${ctx.use("place")}(${name}, ${pos})`;
  if (node.kind === "if")
    return result(`${ctx.use("createIf")}(${parent}, ${place}, ${genBranches(node, ctx)})`);
  if (node.kind === "for")
    return result(`${ctx.use("createFor")}(${parent}, ${place}, ${genForConfig(node, ctx)})`);
  result(place);
  if (node.kind === "interpolation")
    ctx.lines.push(
      `${ctx.use("renderEffect")}(() => ${ctx.use("setText")}(${name}, ${value(node.expression, ctx)}));`,
    );
  if (node.kind !== "element") return block;
  for (const event of node.events) {
    if (!events.has(event.name)) throw new DecaCompileError(`Unknown event "@${event.name}".`);
    const opts = Object.keys(event.options).length ? ", " + JSON.stringify(event.options) : "";
    ctx.lines.push(
      `${ctx.use("on")}(${name}, ${JSON.stringify(event.name)}, ${rewriteHandler(event.handler, ctx.aliases, ctx.contextNames)}${opts});`,
    );
  }
  genClass(node.attrs, name, ctx);
  genAttributes(node, name, ctx);
  if (node.model?.kind === "select") ctx.lines.push(`${ctx.use("prepareSelect")}(${name});`);
  if (node.tag === "option") ctx.lines.push(`${ctx.use("optionsChanged")}(${name});`);
  for (const child of node.children) emit(child, ctx, name);
  if (node.model) genModel(node.model, name, ctx);
  return block;
}
function genAttributes(node: IRElement, name: string, ctx: Ctx) {
  const styles = node.attrs
    .filter((a) => a.name.toLowerCase() === "style")
    .sort((a, b) => Number(a.dynamic) - Number(b.dynamic));
  if (styles.length) {
    const args = styles.map((a) =>
      a.dynamic ? value(a.value!, ctx) : JSON.stringify(a.value ?? ""),
    );
    const call = `${ctx.use("setStyle")}(${name}, ${args.join(", ")})`;
    ctx.lines.push(
      styles.some((a) => a.dynamic) ? `${ctx.use("renderEffect")}(() => ${call});` : call + ";",
    );
  }
  for (const attr of node.attrs) {
    const key = attr.name.toLowerCase();
    if (key === "class" || key === "style") continue;
    const entry = setter(node.tag, attr.name);
    const expr = attr.dynamic ? value(attr.value!, ctx) : "";
    let arg = "";
    if (!attr.dynamic) arg = JSON.stringify(literal(node.tag, key, entry, attr.value));
    else if (entry.kind === "string") arg = `${ctx.use("attributeString")}(${expr})`;
    else if (entry.kind === "boolean")
      arg = key === "spellcheck" ? `${ctx.use("spellcheck")}(${expr})` : `${ctx.use("attributeBoolean")}(${expr})`;
    else arg = `${ctx.use("attributeNumber")}(${expr})`;
    const call = `${name}.${entry.method}(${entry.key ? JSON.stringify(entry.key) + ", " : ""}${arg})`;
    ctx.lines.push(
      attr.dynamic
        ? `${ctx.use("renderEffect")}(() => { ${call};${node.tag === "option" ? " " + ctx.use("optionsChanged") + "(" + name + ");" : ""} });`
        : call + ";",
    );
  }
}
function genClass(attrs: IRElement["attrs"], target: string, ctx: Ctx): void {
  const classAttrs = attrs.filter((a) => a.name.toLowerCase() === "class");
  if (classAttrs.length === 0) return;

  const dynamics = classAttrs.filter((a) => a.dynamic);
  if (dynamics.length > 1) {
    throw new DecaCompileError(
      "Multiple :class bindings on one element are not supported — combine them into a single array/object.",
    );
  }

  const staticAttr = classAttrs.find((a) => !a.dynamic);
  const dynamic = dynamics[0];

  if (!dynamic) {
    ctx.lines.push(`${target}.setClass(${JSON.stringify(staticAttr!.value ?? "")});`);
    return;
  }

  const expr = value(dynamic.value!, ctx);
  const arg = staticAttr
    ? `${ctx.use("normalizeClass")}([${JSON.stringify(staticAttr.value)}, ${expr}])`
    : `${ctx.use("normalizeClass")}(${expr})`;
  ctx.lines.push(`${ctx.use("renderEffect")}(() => ${target}.setClass(${arg}));`);
}

function genModel(model: IRModel, target: string, ctx: Ctx): void {
  const lvalue = rewriteModelTarget(model.expression, ctx.aliases, ctx.contextNames);

  if (model.kind === "checkbox") {
    ctx.lines.push(`${ctx.use("renderEffect")}(() => ${target}.setChecked(!!${lvalue}));`);
    ctx.lines.push(
      `${ctx.use("on")}(${target}, "change", () => { ${lvalue} = ${target}.getChecked(); });`,
    );
    return;
  }

  if (model.kind === "checkbox-array") {
    const value = JSON.stringify(model.staticValue);
    ctx.lines.push(
      `${ctx.use("renderEffect")}(() => ${target}.setChecked(${ctx.use("modelArrayHas")}(${lvalue}, ${value})));`,
    );
    ctx.lines.push(
      `${ctx.use("on")}(${target}, "change", () => { ${lvalue} = ${ctx.use("modelArrayToggle")}(${lvalue}, ${value}, ${target}.getChecked()); });`,
    );
    return;
  }

  if (model.kind === "radio") {
    const value = JSON.stringify(model.staticValue);
    ctx.lines.push(`${ctx.use("renderEffect")}(() => ${target}.setChecked(${lvalue} === ${value}));`);
    ctx.lines.push(
      `${ctx.use("on")}(${target}, "change", () => { if (${target}.getChecked()) ${lvalue} = ${value}; });`,
    );
    return;
  }

  if (model.kind === "select") ctx.lines.push(`${ctx.use("bindSelect")}(${target}, () => ${lvalue});`);
  else ctx.lines.push(`${ctx.use("renderEffect")}(() => ${target}.setValue(${ctx.use("attributeString")}(${lvalue})));`);

  let readback = `${target}.getValue()`;
  if (model.trim) readback = `${readback}.trim()`;
  if (model.number) readback = `${ctx.use("toModelNumber")}(${readback})`;

  const event = model.kind === "select" || model.lazy ? "change" : "input";
  ctx.lines.push(
    `${ctx.use("on")}(${target}, ${JSON.stringify(event)}, () => { ${lvalue} = ${readback}; });`,
  );
}

function genForConfig(node: IRFor, ctx: Ctx): string {
  const source = `() => ${value(node.source, ctx)}`;

  const aliases =
    `{ value: ${genValueBinding(node.valueBinding)}, ` +
    `key: ${node.keyAlias === null ? "null" : JSON.stringify(node.keyAlias)}${node.indexAlias ? ", index: " + JSON.stringify(node.indexAlias) : ""} }`;

  const locals = new Set([...forValueLocals(node.valueBinding), node.keyAlias, node.indexAlias]);
  const rowAliases = new Map(ctx.aliases);
  for (const [name, alias] of rowAliases) {
    if (locals.has(name)) rowAliases.delete(name);
    else if (locals.has(alias.key)) rowAliases.set(name, { ...alias, fromProps: true });
  }
  const contextNames = new Set(ctx.contextNames);
  for (const name of locals) if (name != null) contextNames.add(name);
  const rowFactory = factory(node.children, { ...ctx, aliases: rowAliases, contextNames }, true);
  const keyFn = genKeyFn(node, ctx);

  return (
    `{ ctx: _ctx, source: ${source}, aliases: ${aliases}, ` + `factory: ${rowFactory}, key: ${keyFn} }`
  );
}

function genValueBinding(binding: IRFor["valueBinding"]): string {
  if (binding.kind === "identifier") return JSON.stringify(binding.name);
  const entries = binding.entries
    .map((e) => `{ local: ${JSON.stringify(e.local)}, key: ${JSON.stringify(e.key)} }`)
    .join(", ");
  return `{ destructure: [${entries}] }`;
}

function genKeyFn(node: IRFor, ctx: Ctx): string {
  if (node.keyExpr === null) return "null";

  const params: Array<string> = [node.valueAlias];
  const locals = new Set<string>(forValueLocals(node.valueBinding));
  if (node.keyAlias !== null) {
    params.push(node.keyAlias);
    locals.add(node.keyAlias);
  }
  if (node.indexAlias !== null) {
    params.push(node.indexAlias);
    locals.add(node.indexAlias);
  }

  return `(${params.join(", ")}) => ${value(node.keyExpr, ctx, locals)}`;
}

function genBranches(node: IRIf, ctx: Ctx): string {
  const parts = node.branches.map((branch) => {
    const condition =
      branch.condition === null ? "null" : `() => ${value(branch.condition, ctx)}`;
    return `{ condition: ${condition}, factory: ${factory(branch.children, ctx)} }`;
  });
  return `[${parts.join(", ")}]`;
}

function genProps(props: IRComponent["props"], ctx: Ctx): string {
  if (props.length === 0) return "{}";
  const parts = props.map((p) => {
    const getter = p.dynamic ? value(p.value, ctx) : JSON.stringify(p.value);
    return `${JSON.stringify(camelizeProp(p.name))}: () => ${getter}`;
  });
  return `{ ${parts.join(", ")} }`;
}

function camelizeProp(name: string): string {
  return name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}
