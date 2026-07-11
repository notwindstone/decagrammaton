import { test, expect, describe } from "bun:test";
import { renderSource } from "./support.ts";
import { DecaCompileError } from "../src/compiler/errors.ts";

// ── Whitelist-by-construction + codegen shape (slices 3, 5, 6) ───────────────
//
// The load-bearing security property: there is NO generic createElement /
// setAttribute / addEventListener. Every tag, attr, and event is resolved to a
// NAMED ark method at build time, and anything without a table entry THROWS in
// codegen. That build-time throw IS the whitelist. These tests assert both sides:
// known constructs emit the right named call, unknown ones fail the build.
//
// String-layer by design — the emitted source is the artifact codegen is
// responsible for. Whether those calls then paint pixels is covered by the DOM
// e2e tests (reactivity/v-for/props); here we pin the codegen contract.

describe("whitelist throws — no generic DOM escape hatch", () => {
  test("an unknown tag has no ark creator and throws", () => {
    expect(() => renderSource(`<marquee>x</marquee>`)).toThrow(DecaCompileError);
    expect(() => renderSource(`<marquee>x</marquee>`)).toThrow(/Unknown tag <marquee>/);
  });

  test("an unknown attribute has no ark setter and throws", () => {
    // No setAttribute fallback — an unmapped attr has nothing to call.
    expect(() => renderSource(`<div foo="bar">x</div>`)).toThrow(/Unknown attribute "foo"/);
  });

  test("an unknown event has no ark handler and throws", () => {
    expect(() => renderSource(`<div @wheel="f">x</div>`)).toThrow(/Unknown event "@wheel"/);
  });

  test("a dynamic attribute NAME (:[expr]) has nothing to whitelist and throws", () => {
    expect(() => renderSource(`<div :[name]="x">y</div>`)).toThrow(DecaCompileError);
  });
});

describe("attribute codegen (slice 5)", () => {
  test("a static attr emits ONE named setter call with a string literal", () => {
    const src = renderSource(`<div class="box">hi</div>`);
    expect(src).toContain(`n0.setClass("box")`);
    expect(src).not.toContain("renderEffect"); // static: no effect wrapper
  });

  test("a dynamic :attr wraps the setter in a renderEffect with a prefixed expr", () => {
    const src = renderSource(`<div :class="cls">hi</div>`);
    expect(src).toContain(`renderEffect(() => n0.setClass(_ctx.cls))`);
  });

  test("data-/aria- use the two-arg setter, key first, author casing preserved", () => {
    expect(renderSource(`<div data-id="5">x</div>`)).toContain(`n0.setData("id", "5")`);
    expect(renderSource(`<div :aria-label="lbl">x</div>`)).toContain(
      `renderEffect(() => n0.setAria("label", _ctx.lbl))`,
    );
  });

  test("a valueless boolean attr emits the string \"true\", not \"\"", () => {
    // ark boolean setters guard on `if (value)`, so "" (falsy) would no-op.
    const src = renderSource(`<input readonly />`);
    expect(src).toContain(`n0.setReadonly("true")`);
  });

  test("an explicit empty class=\"\" keeps its own empty string", () => {
    expect(renderSource(`<div class="">x</div>`)).toContain(`n0.setClass("")`);
  });

  test("attr-name casing is normalized to lowercase for the setter lookup", () => {
    // baseParse preserves `maxLength`; codegen lowercases before the table hit.
    expect(renderSource(`<input :maxLength="n" />`)).toContain("setMaxLength");
  });
});

describe("tag creators — named methods, never createElement (slice 5 tables)", () => {
  test("headings route through the arity creator", () => {
    expect(renderSource(`<h3>t</h3>`)).toContain(`gui.createHeading(3)`);
  });

  test("lists route through createList with the list-type argument", () => {
    expect(renderSource(`<ul><li>a</li></ul>`)).toContain(`gui.createList("unordered")`);
    expect(renderSource(`<ol><li>a</li></ol>`)).toContain(`gui.createList("ordered")`);
  });

  test("inline formatting routes through createFormatting(tag)", () => {
    expect(renderSource(`<strong>b</strong>`)).toContain(`gui.createFormatting("strong")`);
  });

  test("a plain element maps to its dedicated creator, never a generic one", () => {
    const src = renderSource(`<button>go</button>`);
    expect(src).toContain(`gui.createButton()`);
    expect(src).not.toMatch(/createElement/);
  });
});

describe("structural directive codegen shape (slices 3, 4, 6)", () => {
  test("a root-level v-if emits a rootIf marker with lazy condition + factory", () => {
    const src = renderSource(`<p v-if="a">A</p><p v-else>B</p>`);
    expect(src).toContain("rootIf(");
    expect(src).toContain(`condition: () => _ctx.a`); // lazy getter, tracked in effect
    expect(src).toContain(`condition: null`);         // v-else
    expect(src).toContain(`factory: () =>`);          // lazy branch builder
  });

  test("a root-level v-for emits a rootFor marker with source/aliases/key config", () => {
    const src = renderSource(`<ul><li v-for="(x, i) in xs" :key="x.id">{{ x }}</li></ul>`);
    expect(src).toContain("createFor(");
    expect(src).toContain(`source: () => _ctx.xs`);
    expect(src).toContain(`aliases: { value: "x", key: "i", index: null }`);
    // :key params are row locals — seeded, so they stay BARE (not _ctx.x.id).
    expect(src).toContain(`key: (x, i) => x.id`);
  });

  test("an unkeyed v-for emits key: null", () => {
    expect(renderSource(`<ul><li v-for="x in xs">{{ x }}</li></ul>`)).toContain("key: null");
  });

  test("a component resolves at RUNTIME via _ctx[tag], props as uniform getters", () => {
    const src = renderSource(`<Child name="w" :count="c" />`);
    expect(src).toContain(`createComponent(_ctx.Child,`);
    // static + dynamic props both emitted as getters — dynamic tracks the signal.
    expect(src).toContain(`"name": () => "w"`);
    expect(src).toContain(`"count": () => _ctx.c`);
  });
});

describe("component fail-loud (slice 6 boundaries)", () => {
  test("component @events (defineEmits) are not in this slice and throw", () => {
    expect(() => renderSource(`<Child @go="f" />`)).toThrow(/Component events/);
  });

  test("component slots (children) are not in this slice and throw", () => {
    expect(() => renderSource(`<Child>hi</Child>`)).toThrow(/Slots on <Child>/);
  });
});
