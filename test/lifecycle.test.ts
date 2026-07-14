import { test, expect, describe } from "bun:test";
import { compileRender, freshApp } from "./support.ts";
import { signal } from "../src/reactivity.ts";
import { createApp, type ComponentModule } from "../src/runtime/component.ts";
import { onMounted, onUnmounted } from "../src/runtime/lifecycle.ts";

// ── onMounted / onUnmounted (Vue 3 lifecycle) ─────────────────────────────────
//
// Regression: onMounted was a blind re-export of sigrea's onMount, which needs a
// molecule mount-job registry decagrammaton never creates — so any use threw
// "onMount(...) can only be called synchronously during molecule setup." These
// hooks are now decagrammaton's own (src/runtime/lifecycle.ts), wired to the
// component mount sites. See that file for timing/ordering rationale.

function makeModule(template: string, setup: ComponentModule["setup"]): ComponentModule {
  return { setup, render: compileRender(template) as ComponentModule["render"] };
}

describe("onMounted / onUnmounted", () => {
  test("onMounted fires once on mount (no throw)", () => {
    let calls = 0;
    const App = makeModule(`<div class="root"></div>`, () => {
      onMounted(() => { calls++; });
      return {};
    });

    const { gui, app } = freshApp();
    const dispose = createApp(App).mount(gui.getElement("app")!, gui);

    expect(calls).toBe(1);
    expect(app.querySelector(".root")).toBeTruthy();
    dispose();
  });

  test("onMounted sees its own node already in the live DOM", () => {
    let foundInDom = false;
    const App = makeModule(`<div id="probe">hi</div>`, () => {
      onMounted(() => {
        // The whole tree is inserted before the batch flushes, so the node is
        // queryable from the real document at callback time.
        foundInDom = document.getElementById("probe") !== null;
      });
      return {};
    });

    const { gui } = freshApp();
    const dispose = createApp(App).mount(gui.getElement("app")!, gui);

    expect(foundInDom).toBe(true);
    dispose();
  });

  test("child onMounted fires before parent onMounted (Vue order)", () => {
    const order: Array<string> = [];
    const Child = makeModule(`<span class="c"></span>`, () => {
      onMounted(() => order.push("child"));
      return {};
    });
    const Parent = makeModule(`<div><Child></Child></div>`, () => {
      onMounted(() => order.push("parent"));
      return { Child };
    });

    const { gui } = freshApp();
    const dispose = createApp(Parent).mount(gui.getElement("app")!, gui);

    expect(order).toEqual(["child", "parent"]);
    dispose();
  });

  test("onUnmounted fires when the app is disposed", () => {
    let unmounted = 0;
    const App = makeModule(`<div></div>`, () => {
      onUnmounted(() => { unmounted++; });
      return {};
    });

    const { gui } = freshApp();
    const dispose = createApp(App).mount(gui.getElement("app")!, gui);
    expect(unmounted).toBe(0);
    dispose();
    expect(unmounted).toBe(1);
  });

  test("a v-if child mounted by a LATER condition flip still fires onMounted", () => {
    const order: Array<string> = [];
    const Child = makeModule(`<span class="late"></span>`, () => {
      onMounted(() => order.push("mounted"));
      onUnmounted(() => order.push("unmounted"));
      return {};
    });
    const show = signal(false);
    const App = makeModule(`<div><Child v-if="show"></Child></div>`, () => ({ Child, show }));

    const { gui, app } = freshApp();
    const dispose = createApp(App).mount(gui.getElement("app")!, gui);

    // Not shown initially → no hook, no node.
    expect(order).toEqual([]);
    expect(app.querySelector(".late")).toBeNull();

    // Flip on: this remount runs in a reactive effect OUTSIDE the root batch, so
    // createIf must open+flush its own batch — the pre-fix bug threw right here.
    show.value = true;
    expect(order).toEqual(["mounted"]);
    expect(app.querySelector(".late")).toBeTruthy();

    // Flip off: branch scope disposes → onUnmounted runs.
    show.value = false;
    expect(order).toEqual(["mounted", "unmounted"]);
    expect(app.querySelector(".late")).toBeNull();

    dispose();
  });

  test("a v-for row child fires onMounted when a new item is added", () => {
    let mounts = 0;
    const Row = makeModule(`<li></li>`, () => {
      onMounted(() => { mounts++; });
      return {};
    });
    const items = signal<Array<number>>([1]);
    const App = makeModule(
      `<ul><Row v-for="n in items" :key="n"></Row></ul>`,
      () => ({ Row, items }),
    );

    const { gui, app } = freshApp();
    const dispose = createApp(App).mount(gui.getElement("app")!, gui);

    expect(mounts).toBe(1); // initial row
    items.value = [1, 2];   // reactive add → new row's onMounted fires
    expect(mounts).toBe(2);
    expect(app.querySelectorAll("li")).toHaveLength(2);

    dispose();
  });

  test("onMounted throws if called outside setup()", () => {
    expect(() => onMounted(() => {})).toThrow(/only be called synchronously during setup/);
  });

  test("onUnmounted throws if called outside setup()", () => {
    expect(() => onUnmounted(() => {})).toThrow(/only be called synchronously during setup/);
  });
});
