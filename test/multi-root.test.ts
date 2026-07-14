import { test, expect, describe } from "bun:test";
import { renderSource, compileRender, freshApp } from "./support.ts";
import { signal } from "../src/reactivity.ts";
import { createApp, createComponent, type ComponentModule } from "../src/runtime/component.ts";

// ── Multi-root components ─────────────────────────────────────────────────────
//
// A component's <template> may now yield N sibling roots — `<div/><div/>` — not
// just one. app-level multi-root already worked (createApp.mount loops the root
// list); the gap was CHILD components: createComponent used to throw on >1 root.
//
// The model: a component evaluates to a FRAGMENT (Array<SafeElement>). Every site
// that embeds a `<Child/>` splices that array — an element/slot child appends each
// root (appendAll), a render root / v-if branch / v-for row spreads them into its
// returned node list. Two shapes still fail loud: a bare v-if/v-for root (no
// container to bind here) and a zero-node render (no placeholder to hold position).

function makeModule(template: string, setup: ComponentModule["setup"]): ComponentModule {
  return { setup, render: compileRender(template) as ComponentModule["render"] };
}

describe("multi-root — codegen string layer", () => {
  test("a component child of an element splices via appendAll", () => {
    // The child is a fragment, so the parent appends ALL its roots — appendAll, not
    // the single-node append used for elements/text.
    const src = renderSource(`<section><Child></Child></section>`);
    expect(src).toContain("appendAll(");
    expect(src).toContain("createComponent(_ctx.Child,");
  });

  test("a plain element child still uses single-node append", () => {
    const src = renderSource(`<section><span>x</span></section>`);
    expect(src).toContain("append(");
    expect(src).not.toContain("appendAll(");
  });

  test("a component at the render root is spread into the roots array", () => {
    // `return [...n0]` — the fragment flattens into render's own root list so the
    // mount site sees each sibling node, exactly like the app root loop expects.
    const src = renderSource(`<Child />`);
    expect(src).toMatch(/return \[\s*\.\.\.n\d+\s*\]/);
  });

  test("a component root inside a v-for row is spread into the row's nodes", () => {
    const src = renderSource(`<ul><Row v-for="r in rows" :key="r.id" /></ul>`);
    // The row factory returns the fragment spread, not a bare node.
    expect(src).toMatch(/return \[\.\.\.n\d+\]/);
  });

  test("a component root inside a v-if branch is spread into the branch's nodes", () => {
    const src = renderSource(`<div><Child v-if="ok" /></div>`);
    expect(src).toMatch(/return \[\.\.\.n\d+\]/);
  });
});

describe("multi-root — DOM end-to-end", () => {
  test("a multi-root child renders all its roots under the parent element", () => {
    const Child = makeModule(`<div class="a"></div><div class="b"></div>`, () => ({}));
    const Parent = makeModule(`<section><Child></Child></section>`, () => ({ Child }));

    const { gui, app } = freshApp();
    const container = gui.getElement("app")!;
    const dispose = createApp(Parent).mount(container, gui);

    expect(app.querySelector("section .a")).toBeTruthy();
    expect(app.querySelector("section .b")).toBeTruthy();
    expect(app.querySelectorAll("section > div")).toHaveLength(2);
    dispose();
  });

  test("a multi-root child at the app root mounts every sibling", () => {
    const Child = makeModule(`<p class="x"></p><p class="y"></p>`, () => ({}));
    const App = makeModule(`<Child />`, () => ({ Child }));

    const { gui, app } = freshApp();
    const container = gui.getElement("app")!;
    const dispose = createApp(App).mount(container, gui);

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
    const container = gui.getElement("app")!;
    const dispose = createApp(Parent).mount(container, gui);

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
    const container = gui.getElement("app")!;
    const dispose = createApp(Parent).mount(container, gui);

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
    const container = gui.getElement("app")!;
    const dispose = createApp(Parent).mount(container, gui);

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
    const container = gui.getElement("app")!;
    const dispose = createApp(Parent).mount(container, gui);

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
    const container = gui.getElement("app")!;
    const dispose = createApp(Parent).mount(container, gui);

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
    const container = gui.getElement("app")!;
    const dispose = createApp(Parent).mount(container, gui);

    expect(app.querySelector("section .solo")?.textContent).toBe("only");
    expect(app.querySelectorAll("section > div")).toHaveLength(1);
    dispose();
  });
});

describe("multi-root — fail loud", () => {
  test("a child that renders zero roots throws", () => {
    // A component with no nodes has nothing to hold its position. createComponent
    // is called directly with a render that yields an empty array.
    const Empty: ComponentModule = { setup: () => ({}), render: () => [] };
    expect(() =>
      createComponent(Empty as ComponentModule, {}, freshApp().gui),
    ).toThrow(/at least one root node/);
  });

  test("a child whose only root is a bare v-if is still rejected", () => {
    // A root-level v-if yields a rootIf MARKER, not a real node — createComponent
    // has no container to bind it, so it fails loud even now that N roots are ok.
    const Child = makeModule(`<b v-if="ok">x</b>`, () => ({ ok: signal(true) }));
    const Parent = makeModule(`<div><Child></Child></div>`, () => ({ Child }));

    const { gui } = freshApp();
    const container = gui.getElement("app")!;
    expect(() => createApp(Parent).mount(container, gui)).toThrow(/bare v-if\/v-for/);
  });
});
