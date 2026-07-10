import { parseExpressionAt, type Node as AcornNode, type AnyNode } from "acorn";
import * as walk from "acorn-walk";
import { isGloballyAllowed } from "@vue/shared";
import { DecaCompileError } from "../errors.ts";

// Rewrite a template expression so its free identifiers resolve against the
// component's runtime context object (`_ctx`).
//
// The AST-based prefixer walks the expression with acorn + acorn-walk and
// prefixes every FREE identifier reference with `_ctx.`, while leaving alone:
//   - member-property keys (`item.id` -> `_ctx.item.id`, not `_ctx.item._ctx.id`)
//   - object-literal keys (`{ id: x }` -> `{ id: _ctx.x }`)
//   - function-local bindings (arrow params: `e => handle(e)` -> `e => _ctx.handle(e)`)
//   - allowed globals (`Math`, `JSON`, `undefined`, ... via @vue/shared) — these
//     resolve to the frozen compartment intrinsics, so they stay bare.
// acorn-walk's base visitors already skip the first two; scope tracking (below)
// handles the third; `isGloballyAllowed` handles the fourth.
//
// The whole expression string must be consumed by a single expression parse —
// trailing content (`count; evil()`) throws, closing off statement injection.

interface Reference {
  start: number;
  name: string;
}

interface PrefixState {
  locals: Set<string>;
  refs: Array<Reference>;
}

// Parse `source` as a single expression and assert nothing trails it.
function parseExpression(source: string): AcornNode {
  let node: AcornNode;
  try {
    node = parseExpressionAt(source, 0, { ecmaVersion: "latest" });
  } catch (error) {
    throw new DecaCompileError(
      `Could not parse template expression ${JSON.stringify(source)}: ${(error as Error).message}`,
    );
  }

  let end = node.end;
  while (end < source.length && /\s/.test(source[end]!)) end++;
  if (end !== source.length) {
    throw new DecaCompileError(
      `Unexpected trailing content in template expression ${JSON.stringify(source)}.`,
    );
  }

  return node;
}

// Record a free identifier for prefixing, unless it is a function-local binding
// or an allowed global.
function recordIdentifier(node: AcornNode, state: PrefixState): void {
  const name = (node as unknown as { name: string }).name;
  if (state.locals.has(name)) return;
  if (isGloballyAllowed(name)) return;
  state.refs.push({ start: node.start, name });
}

// A function scope: its params bind new locals that shadow outer identifiers for
// the duration of the body (and default-value expressions).
function walkFunction(
  node: AcornNode,
  state: PrefixState,
  callback: walk.WalkerCallback<PrefixState>,
): void {
  const fn = node as unknown as { params: Array<AcornNode>; body: AcornNode };
  const locals = new Set(state.locals);

  for (const param of fn.params) {
    const p = param as unknown as { type: string; left?: AcornNode; name?: string };
    if (p.type === "Identifier") {
      locals.add(p.name!);
    } else if (p.type === "AssignmentPattern" && (p.left as { type: string }).type === "Identifier") {
      locals.add((p.left as unknown as { name: string }).name);
    } else {
      throw new DecaCompileError(
        "Destructuring or rest parameters in template expressions are not supported yet.",
      );
    }
  }

  const inner: PrefixState = { locals, refs: state.refs };
  for (const param of fn.params) {
    const p = param as unknown as { type: string; right?: AcornNode };
    if (p.type === "AssignmentPattern") callback(p.right as AnyNode, inner);
  }
  callback(fn.body as AnyNode, inner);
}

// An object-literal property: recurse the value (a reference) but not a static
// key. Shorthand (`{ count }`) would need expansion to `{ count: _ctx.count }`,
// which position-based splicing can't do safely — defer it loudly.
function walkProperty(
  node: AcornNode,
  state: PrefixState,
  callback: walk.WalkerCallback<PrefixState>,
): void {
  const prop = node as unknown as { shorthand: boolean; computed: boolean; key: AcornNode; value: AcornNode };
  if (prop.shorthand) {
    throw new DecaCompileError(
      "Object shorthand in template expressions is not supported yet (write `{ key: value }`).",
    );
  }
  if (prop.computed) callback(prop.key as AnyNode, state);
  callback(prop.value as AnyNode, state);
}

// An assignment's left-hand side is walked by acorn-walk as a binding Pattern,
// whose base `VariablePattern` visitor IGNORES a plain identifier — so `show` in
// `show = !show` would never be prefixed. Record an identifier LHS explicitly;
// a member LHS (`obj.x = 1`) recurses normally and needs no special case.
function walkAssignment(
  node: AcornNode,
  state: PrefixState,
  callback: walk.WalkerCallback<PrefixState>,
): void {
  const assign = node as unknown as { left: AcornNode; right: AcornNode };
  if ((assign.left as { type: string }).type === "Identifier") {
    recordIdentifier(assign.left, state);
  } else {
    callback(assign.left as AnyNode, state);
  }
  callback(assign.right as AnyNode, state);
}

const VISITORS = {
  Identifier: recordIdentifier,
  ArrowFunctionExpression: walkFunction,
  FunctionExpression: walkFunction,
  Property: walkProperty,
  AssignmentExpression: walkAssignment,
} as unknown as walk.RecursiveVisitors<PrefixState>;

// Prefix free identifiers in `source` with `_ctx.`, treating `initialLocals` as
// already-bound names (used to seed `$event` for wrapped inline handlers).
function prefix(source: string, initialLocals: Set<string>): string {
  const ast = parseExpression(source);
  const refs: Array<Reference> = [];
  walk.recursive<PrefixState>(ast, { locals: initialLocals, refs }, VISITORS);

  // Splice right-to-left so earlier offsets stay valid.
  refs.sort((a, b) => b.start - a.start);
  let out = source;
  for (const ref of refs) {
    out = out.slice(0, ref.start) + "_ctx." + out.slice(ref.start);
  }
  return out;
}

// Rewrite an interpolation / v-if condition expression: prefix free identifiers
// against `_ctx`.
export function rewriteExpression(expression: string): string {
  const trimmed = expression.trim();
  if (trimmed === "") {
    throw new DecaCompileError("Empty template expression.");
  }
  return prefix(trimmed, new Set());
}

// Rewrite an `@event` handler, matching Vue's two handler shapes:
//   - a method/function reference (`inc`, `obj.method`, `() => count++`) is
//     passed through prefixed — it IS the handler.
//   - an inline statement (`count++`, `show = !show`, `inc()`) is wrapped into
//     `$event => (...)` so it runs on every event, with `$event` in scope.
export function rewriteHandler(expression: string): string {
  const trimmed = expression.trim();
  if (trimmed === "") {
    throw new DecaCompileError("Empty event handler.");
  }

  const ast = parseExpression(trimmed);
  const type = ast.type;
  if (
    type === "Identifier" ||
    type === "MemberExpression" ||
    type === "ArrowFunctionExpression" ||
    type === "FunctionExpression"
  ) {
    return prefix(trimmed, new Set());
  }

  const inner = prefix(trimmed, new Set(["$event"]));
  return `$event => (${inner})`;
}
