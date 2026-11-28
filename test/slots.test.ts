import { test, expect, describe } from "bun:test";
import { DecaCompileError } from "../src/compiler/errors.ts";
import { renderSource, compileRender, freshApp } from "./support.ts";
import { signal } from "../src/reactivity.ts";
import { createApp, type ComponentModule } from "../src/runtime/component.ts";


describe("slots — codegen string layer", () => {
  test("a <slot> outlet emits mountSlot(parent, $slots, fallbackFactory)", () => {
    const src = renderSource(`<div><slot></slot></div>`);
    expect(src).toContain("mountSlot(");
    expect(src).toContain("$slots");
  });

  test("render receives slots after the mount position", () => {
    const src = renderSource(`<div><slot/></div>`);
    expect(src).toMatch(/function render\(_ctx, gui, parent, before, \$slots\)/);
  });

  test("a component WITH children emits createComponent(..., { default: … })", () => {
    const src = renderSource(`<div><Card><p>hi</p></Card></div>`);
    expect(src).toContain("createComponent(_ctx.Card,");
    expect(src).toContain("{ default:");
  });

  test("a childless component omits slot factories", () => {
    // The whitespace-only body collapses to null → no slots arg. This is what
    // keeps existing `<DemoGrid>\n</DemoGrid>` usage compiling as "no slot passed".
    const src = renderSource(`<div><Card>\n  </Card></div>`);
    expect(src).toContain("createComponent(_ctx.Card, {}, gui, n0)");
    expect(src).not.toContain("{ default:");
  });

  test("the fallback factory takes a parent and appends into it (fragment shape)", () => {
    const src = renderSource(`<div><slot>fallback</slot></div>`);
    // The fallback body appends its own text node into the handed-in _parent.
    expect(src).toMatch(/\(parent, before\) => \{/);
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

  test("a root-level slot mounts into the supplied parent", () => {
    expect(renderSource("<slot/>")).toContain("mountSlot(parent, before, $slots");
  });
});


function makeModule(template: string, setup: ComponentModule["setup"]): ComponentModule {
  return { setup, render: compileRender(template) as ComponentModule["render"] };
}

describe("slots — DOM end-to-end", () => {
  test("parent content appears at the child's outlet", () => {
    const Child = makeModule(`<div class="card"><slot>fallback</slot></div>`, () => ({}));
    const Parent = makeModule(`<div><Child><p>hello</p></Child></div>`, () => ({ Child }));

    const { gui, app } = freshApp();
    const dispose = createApp(Parent).mount(gui);

    expect(app.querySelector(".card p")?.textContent).toBe("hello");
    expect(app.textContent).not.toContain("fallback"); // parent filled the slot
    dispose();
  });

  test("an unfilled <slot> renders its fallback", () => {
    const Child = makeModule(`<div class="card"><slot>fallback</slot></div>`, () => ({}));
    const Parent = makeModule(`<div><Child></Child></div>`, () => ({ Child }));

    const { gui, app } = freshApp();
    const dispose = createApp(Parent).mount(gui);

    expect(app.querySelector(".card")?.textContent).toBe("fallback");
    dispose();
  });

  test("slot content that reads a parent signal updates reactively", () => {
    const msg = signal("first");
    const Child = makeModule(`<div class="card"><slot></slot></div>`, () => ({}));
    const Parent = makeModule(`<div><Child><span>{{ msg }}</span></Child></div>`, () => ({ Child, msg }));

    const { gui, app } = freshApp();
    const dispose = createApp(Parent).mount(gui);

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
    const dispose = createApp(Parent).mount(gui);

    const span = app.querySelector(".card span")!;
    expect(span.textContent).toBe("live");

    const text = span.firstChild!;
    dispose();
    // After teardown the slot effect must be dead: a further parent mutation must
    // NOT reach the (now-detached) node. Reading the captured node proves the
    // effect stopped writing — if it were still live it would say "leaked".
    msg.value = "leaked";
    expect(text.textContent).toBe("live");
  });
});
