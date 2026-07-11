import { test, expect, describe } from "bun:test";
import { rewriteExpression, rewriteHandler } from "../src/compiler/template/expression.ts";
import { DecaCompileError } from "../src/compiler/errors.ts";

// ── Slice 3.5: the acorn free-variable prefixer ──────────────────────────────
//
// rewriteExpression prefixes every FREE identifier with `_ctx.` so template
// expressions resolve against the component context, while leaving member keys,
// object-literal keys, function-local params, and allowed globals alone.
// rewriteHandler adds Vue's two handler shapes: a reference passes through, an
// inline statement is wrapped into `$event => (...)`.
//
// These are pure string->string, so they are unit-tested directly. The fixtures
// are mined from Counter.vue's deliberately-nasty template expressions (the
// "prefixer edge-case" block) plus each iteration's §VERIFIED probes.

describe("rewriteExpression — free identifiers (slice 3.5)", () => {
  test("a bare identifier is prefixed", () => {
    expect(rewriteExpression("count")).toBe("_ctx.count");
  });

  test("a member chain prefixes only the ROOT, not the property keys", () => {
    // `item.id` -> `_ctx.item.id`, NOT `_ctx.item._ctx.id`.
    expect(rewriteExpression("releases.Name")).toBe("_ctx.releases.Name");
    expect(rewriteExpression("error?.message")).toBe("_ctx.error?.message");
  });

  test("object-literal keys stay bare; only values are prefixed", () => {
    expect(rewriteExpression("{ id: x }")).toBe("{ id: _ctx.x }");
  });

  test("a computed member key IS prefixed (it is a real reference)", () => {
    // items?.[selectedIndex] — the index is a free var, the `items` root too.
    expect(rewriteExpression("items?.[selectedIndex]?.title ?? \"none\""))
      .toBe("_ctx.items?.[_ctx.selectedIndex]?.title ?? \"none\"");
  });

  test("allowed globals (Math, JSON, undefined) stay bare", () => {
    expect(rewriteExpression("Math.max(count, 0)")).toBe("Math.max(_ctx.count, 0)");
    expect(rewriteExpression("undefined")).toBe("undefined");
  });

  test("comparison against a null literal — literal untouched, ident prefixed", () => {
    expect(rewriteExpression("error !== null")).toBe("_ctx.error !== null");
    expect(rewriteExpression("failureCount > 0")).toBe("_ctx.failureCount > 0");
  });

  test("ternary + optional-call + member-key (the gnarliest Counter fixture)", () => {
    const src = `error === null ? label?.replace?.("%s", releases.Name) : "no release"`;
    expect(rewriteExpression(src)).toBe(
      `_ctx.error === null ? _ctx.label?.replace?.("%s", _ctx.releases.Name) : "no release"`,
    );
  });

  test("an arrow's params are locals and stay bare; free calls are prefixed", () => {
    expect(rewriteExpression("e => handle(e)")).toBe("e => _ctx.handle(e)");
  });

  test("`locals` seed keeps declared names bare (the :key callback path)", () => {
    // v-for :key emits `(row) => row.id` with `row` seeded — must NOT become _ctx.row.
    expect(rewriteExpression("row.id", new Set(["row"]))).toBe("row.id");
  });
});

describe("rewriteExpression — fail-loud rejections (slice 3.5)", () => {
  test("empty expression throws", () => {
    expect(() => rewriteExpression("   ")).toThrow(DecaCompileError);
  });

  test("trailing content (statement injection) throws", () => {
    // The single-expression parse closes off `count; evil()`.
    expect(() => rewriteExpression("count; evil()")).toThrow(/trailing content/i);
  });

  test("a statement-body arrow is rejected (untracked local bindings)", () => {
    expect(() => rewriteExpression("() => { const x = 1; return x }")).toThrow(
      /Statement-body functions/i,
    );
  });

  test("object shorthand is rejected (can't splice an expansion)", () => {
    expect(() => rewriteExpression("{ count }")).toThrow(/shorthand/i);
  });

  test("a destructuring assignment target is rejected", () => {
    expect(() => rewriteExpression("[a, b] = pair")).toThrow(/Destructuring/i);
  });
});

describe("rewriteHandler — the two Vue handler shapes (slice 3.5)", () => {
  test("a method reference passes through prefixed (it IS the handler)", () => {
    expect(rewriteHandler("inc")).toBe("_ctx.inc");
    expect(rewriteHandler("obj.method")).toBe("_ctx.obj.method");
  });

  test("an arrow reference passes through prefixed, NOT wrapped", () => {
    expect(rewriteHandler("() => count++")).toBe("() => _ctx.count++");
  });

  test("an inline statement is wrapped into `$event => (...)`", () => {
    // `count++` runs on every event; $event is in scope and stays bare.
    expect(rewriteHandler("count++")).toBe("$event => (_ctx.count++)");
  });

  test("an assignment statement wraps and prefixes the LHS identifier", () => {
    // The VariablePattern=ignore trap: `show` on the LHS must still get _ctx.
    expect(rewriteHandler("show = !show")).toBe("$event => (_ctx.show = !_ctx.show)");
  });

  test("an inline statement can reference $event without prefixing it", () => {
    expect(rewriteHandler("failureCount = $event.target.value")).toBe(
      "$event => (_ctx.failureCount = $event.target.value)",
    );
  });

  test("a call expression is an inline statement, so it wraps", () => {
    expect(rewriteHandler("inc()")).toBe("$event => (_ctx.inc())");
  });

  test("empty handler throws", () => {
    expect(() => rewriteHandler("  ")).toThrow(/Empty event handler/i);
  });
});
