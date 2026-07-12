import { test, expect, describe } from "bun:test";
import { DecaCompileError } from "../src/compiler/errors.ts";
import { renderSource, compileRender, freshApp } from "./support.ts";
import { signal } from "../src/reactivity.ts";
import { createApp, type ComponentModule } from "../src/runtime/component.ts";

// ── Slots: the basic default slot ────────────────────────────────────────────
//
// A component may now accept children: `<Child>…content…</Child>` renders that
// content at the child's `<slot>` outlet. The content is PARENT-authored (built
// with the parent's ctx) but lives in the CHILD's DOM — the same "capture parent
// scope, run the factory later" shape createIf/createFor already establish, so a
// slot expression that reads a parent signal stays reactive and its effects
// dispose with the parent. Only the DEFAULT slot exists; named (`<slot name>`,
// `<template #x>`, `v-slot`) and scoped (`<slot :x>`) slots are rejected fail-loud.

describe("slots — codegen string layer", () => {
  test("a <slot> outlet emits mountSlot(parent, $slots, fallbackFactory)", () => {
    const src = renderSource(`<div><slot></slot></div>`);
    expect(src).toContain("mountSlot(");
    expect(src).toContain("$slots");
  });

  test("render() gains the 3rd $slots parameter", () => {
    const src = renderSource(`<div><slot/></div>`);
    expect(src).toMatch(/function render\(_ctx, gui, \$slots\)/);
  });

  test("a component WITH children emits createComponent(..., { default: … })", () => {
    const src = renderSource(`<div><Card><p>hi</p></Card></div>`);
    expect(src).toContain("createComponent(_ctx.Card,");
    expect(src).toContain("{ default:");
  });

  test("a childless component emits the 3-arg createComponent unchanged", () => {
    // The whitespace-only body collapses to null → no slots arg. This is what
    // keeps existing `<DemoGrid>\n</DemoGrid>` usage compiling as "no slot passed".
    const src = renderSource(`<div><Card>\n  </Card></div>`);
    expect(src).toContain("createComponent(_ctx.Card, {}, gui)");
    expect(src).not.toContain("{ default:");
  });

  test("the fallback factory takes a parent and appends into it (fragment shape)", () => {
    const src = renderSource(`<div><slot>fallback</slot></div>`);
    // The fallback body appends its own text node into the handed-in _parent.
    expect(src).toMatch(/\(_parent\) => \{/);
  });
});

describe("slots — fail loud on unsupported shapes", () => {
  test("a named slot outlet <slot name> is rejected", () => {
    expect(() => renderSource(`<div><slot name="header"></slot></div>`)).toThrow(DecaCompileError);
    expect(() => renderSource(`<div><slot name="header"></slot></div>`)).toThrow(/[Nn]amed slot/);
  });

  test("a scoped slot outlet <slot :x> is rejected", () => {
    expect(() => renderSource(`<div><slot :item="x"></slot></div>`)).toThrow(DecaCompileError);
    expect(() => renderSource(`<div><slot :item="x"></slot></div>`)).toThrow(/[Ss]coped slot/);
  });

  test("a named-slot <template #x> child of a component is rejected", () => {
    expect(() => renderSource(`<div><Card><template #x>y</template></Card></div>`)).toThrow(DecaCompileError);
  });

  test("v-slot on the component element is rejected", () => {
    expect(() => renderSource(`<div><Card v-slot="s">y</Card></div>`)).toThrow(DecaCompileError);
  });

  test("a root-level <slot> (no wrapping element) is rejected", () => {
    expect(() => renderSource(`<slot></slot>`)).toThrow(DecaCompileError);
    expect(() => renderSource(`<slot></slot>`)).toThrow(/root-level/);
  });
});

// ── DOM end-to-end ────────────────────────────────────────────────────────────
//
// Real codegen for BOTH parent and child, executed against real ark nodes + real
// DOM. The child's render is compiled from its template; the parent's from its.
// createApp drives the genuine mount path (root instance + scope), so the slot
// factory really is wrapped and re-run under the parent — this is the integration
// proof, not a hand-built module.

function makeModule(template: string, setup: ComponentModule["setup"]): ComponentModule {
  // compileRender returns the exact `render(_ctx, gui, $slots)` closure codegen
  // emits, closed over the real runtime helpers — so this is the true output run.
  return { setup, render: compileRender(template) as ComponentModule["render"] };
}

describe("slots — DOM end-to-end", () => {
  test("parent content appears at the child's outlet", () => {
    const Child = makeModule(`<div class="card"><slot>fallback</slot></div>`, () => ({}));
    const Parent = makeModule(`<div><Child><p>hello</p></Child></div>`, () => ({ Child }));

    const { gui, app } = freshApp();
    const container = gui.getElement("app")!;
    const dispose = createApp(Parent).mount(container, gui);

    expect(app.querySelector(".card p")?.textContent).toBe("hello");
    expect(app.textContent).not.toContain("fallback"); // parent filled the slot
    dispose();
  });

  test("an unfilled <slot> renders its fallback", () => {
    const Child = makeModule(`<div class="card"><slot>fallback</slot></div>`, () => ({}));
    const Parent = makeModule(`<div><Child></Child></div>`, () => ({ Child }));

    const { gui, app } = freshApp();
    const container = gui.getElement("app")!;
    const dispose = createApp(Parent).mount(container, gui);

    expect(app.querySelector(".card")?.textContent).toBe("fallback");
    dispose();
  });

  test("slot content that reads a parent signal updates reactively", () => {
    const msg = signal("first");
    const Child = makeModule(`<div class="card"><slot></slot></div>`, () => ({}));
    const Parent = makeModule(`<div><Child><span>{{ msg }}</span></Child></div>`, () => ({ Child, msg }));

    const { gui, app } = freshApp();
    const container = gui.getElement("app")!;
    const dispose = createApp(Parent).mount(container, gui);

    expect(app.querySelector(".card span")?.textContent).toBe("first");
    msg.value = "second"; // mutate the PARENT signal — the slot effect re-runs
    expect(app.querySelector(".card span")?.textContent).toBe("second");
    dispose();
  });

  test("disposing the app tears the slot content's effects down (no leak)", () => {
    const msg = signal("live");
    const Child = makeModule(`<div class="card"><slot></slot></div>`, () => ({}));
    const Parent = makeModule(`<div><Child><span>{{ msg }}</span></Child></div>`, () => ({ Child, msg }));

    const { gui, app } = freshApp();
    const container = gui.getElement("app")!;
    const dispose = createApp(Parent).mount(container, gui);

    const span = app.querySelector(".card span")!;
    expect(span.textContent).toBe("live");

    dispose();
    // After teardown the slot effect must be dead: a further parent mutation must
    // NOT reach the (now-detached) node. Reading the captured node proves the
    // effect stopped writing — if it were still live it would say "leaked".
    msg.value = "leaked";
    expect(span.textContent).toBe("live");
  });
});
