import { test, expect, describe } from "bun:test";
import { compileRender, freshApp } from "./support.ts";
import { signal } from "../src/reactivity.ts";
import { createApp, type ComponentModule } from "../src/runtime/component.ts";


function makeModule(template: string, setup: ComponentModule["setup"]): ComponentModule {
  return { setup, render: compileRender(template) as ComponentModule["render"] };
}

describe("multi-root — DOM end-to-end", () => {
  test("a multi-root child renders all its roots under the parent element", () => {
    const Child = makeModule(`<div class="a"></div><div class="b"></div>`, () => ({}));
    const Parent = makeModule(`<section><Child></Child></section>`, () => ({ Child }));

    const { gui, app } = freshApp();
    const dispose = createApp(Parent).mount(gui);

    expect(app.querySelector("section .a")).toBeTruthy();
    expect(app.querySelector("section .b")).toBeTruthy();
    expect(app.querySelectorAll("section > div")).toHaveLength(2);
    dispose();
  });

  test("a multi-root child at the app root mounts every sibling", () => {
    const Child = makeModule(`<p class="x"></p><p class="y"></p>`, () => ({}));
    const App = makeModule(`<Child />`, () => ({ Child }));

    const { gui, app } = freshApp();
    const dispose = createApp(App).mount(gui);

    expect(app.querySelectorAll("p")).toHaveLength(2);
    expect(app.querySelector(".x")).toBeTruthy();
    expect(app.querySelector(".y")).toBeTruthy();
    dispose();
  });

  test("roots keep author order and sit between the parent's other children", () => {
    const Child = makeModule(`<span class="m">M</span><span class="n">N</span>`, () => ({}));
    const Parent = makeModule(
      `<div><span class="before">B</span><Child></Child><span class="after">A</span></div>`,
      () => ({ Child }),
    );

    const { gui, app } = freshApp();
    const dispose = createApp(Parent).mount(gui);

    const spans = Array.from(app.querySelectorAll("span")).map((s) => s.textContent);
    expect(spans).toEqual(["B", "M", "N", "A"]);
    dispose();
  });

  test("each root of a multi-root child is independently reactive", () => {
    const a = signal("a0");
    const b = signal("b0");
    const Child = makeModule(
      `<div class="a">{{ a }}</div><div class="b">{{ b }}</div>`,
      () => ({ a, b }),
    );
    const Parent = makeModule(`<section><Child></Child></section>`, () => ({ Child }));

    const { gui, app } = freshApp();
    const dispose = createApp(Parent).mount(gui);

    expect(app.querySelector(".a")?.textContent).toBe("a0");
    expect(app.querySelector(".b")?.textContent).toBe("b0");

    a.value = "a1"; // mutate only the first root's signal
    expect(app.querySelector(".a")?.textContent).toBe("a1");
    expect(app.querySelector(".b")?.textContent).toBe("b0"); // untouched
    dispose();
  });

  test("a multi-root child inside a v-for renders every root per row", () => {
    const rows = signal([{ id: 1 }, { id: 2 }]);
    const Cell = makeModule(`<td class="l"></td><td class="r"></td>`, () => ({}));
    const Parent = makeModule(
      `<table><Cell v-for="row in rows" :key="row.id" /></table>`,
      () => ({ Cell, rows }),
    );

    const { gui, app } = freshApp();
    const dispose = createApp(Parent).mount(gui);

    // 2 rows × 2 roots each = 4 cells.
    expect(app.querySelectorAll("td")).toHaveLength(4);
    expect(app.querySelectorAll("td.l")).toHaveLength(2);
    expect(app.querySelectorAll("td.r")).toHaveLength(2);

    rows.value = [{ id: 1 }]; // drop a row → its two roots leave together
    expect(app.querySelectorAll("td")).toHaveLength(2);
    dispose();
  });

  test("a multi-root child inside a v-if mounts/unmounts all roots together", () => {
    const show = signal(true);
    const Child = makeModule(`<i class="p"></i><i class="q"></i>`, () => ({}));
    const Parent = makeModule(
      `<div><Child v-if="show" /></div>`,
      () => ({ Child, show }),
    );

    const { gui, app } = freshApp();
    const dispose = createApp(Parent).mount(gui);

    expect(app.querySelectorAll("i")).toHaveLength(2);
    show.value = false;
    expect(app.querySelectorAll("i")).toHaveLength(0); // both roots gone
    show.value = true;
    expect(app.querySelectorAll("i")).toHaveLength(2); // both back
    dispose();
  });

  test("a nested multi-root child (grandchild) flattens through both levels", () => {
    const Leaf = makeModule(`<b class="l1"></b><b class="l2"></b>`, () => ({}));
    const Mid = makeModule(`<Leaf /><Leaf />`, () => ({ Leaf }));
    const Parent = makeModule(`<div><Mid></Mid></div>`, () => ({ Mid }));

    const { gui, app } = freshApp();
    const dispose = createApp(Parent).mount(gui);

    // Mid = 2 × Leaf, each Leaf = 2 roots → 4 <b> under the div.
    expect(app.querySelectorAll("div > b")).toHaveLength(4);
    expect(app.querySelectorAll("b.l1")).toHaveLength(2);
    expect(app.querySelectorAll("b.l2")).toHaveLength(2);
    dispose();
  });

  test("a single-root child still works unchanged (fragment of length 1)", () => {
    const Child = makeModule(`<div class="solo">only</div>`, () => ({}));
    const Parent = makeModule(`<section><Child></Child></section>`, () => ({ Child }));

    const { gui, app } = freshApp();
    const dispose = createApp(Parent).mount(gui);

    expect(app.querySelector("section .solo")?.textContent).toBe("only");
    expect(app.querySelectorAll("section > div")).toHaveLength(1);
    dispose();
  });
});

test("empty and conditional child roots mount directly between siblings", () => {
  const ok = signal(false);
  const Child = makeModule("<b v-if='ok'>x</b>", () => ({ok}));
  const Empty = makeModule("", () => ({}));
  const Parent = makeModule("<span>A</span><Empty/><Child/><span>B</span>", () => ({Child, Empty}));
  const { gui, app } = freshApp();
  const dispose = createApp(Parent).mount(gui);
  expect(app.textContent).toBe("AB");
  ok.value = true;
  expect(app.textContent).toBe("AxB");
  dispose();
});
