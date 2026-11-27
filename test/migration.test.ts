import { test, expect } from "bun:test";
import { compileSFC, compileRender, freshApp, mountTemplate } from "./support.ts";
import { createApp, inject, onMounted, onUnmounted, provide, signal } from "../src/index.ts";
import { createProps, mergeDefaults } from "../src/runtime/context.ts";
import { DecaCompileError } from "../src/compiler/errors.ts";
import { parseForValueAlias } from "../src/compiler/template/expression.ts";

for (const template of [
  '<div v-if="yes" v-for="x in xs"/>',
  '<div v-if="yes"/><div v-else v-for="x in xs"/>',
  '<div :id.prop="id"/>',
  '<button @click.enter="run"/>',
  '<input v-model.unknown="x"/>',
  '<input v-model="Math"/>',
  '<div href="https://example.org"/>',
  '<td scope="row"/>',
  '<div data-ID="1"/>',
  '<th colspan="1.5"/>',
  '<textarea rows="0"/>',
  '<meter value="Infinity"/>',
  '<input type="file"/>',
  "<input>child</input>",
  "<notanelement/>",
  "<div></p>",
]) {
  test("rejects " + template, () => {
    expect(() => compileSFC("<template>" + template + "</template>")).toThrow(DecaCompileError);
  });
}

test("script and CSS errors use DecaCompileError", () => {
  for (const extra of [
    "<script>export default {}</script>",
    "<style>.x{background:url(https://example.org/x)}</style>",
    "<script setup>defineModel()</script>",
  ]) {
    expect(() => compileSFC("<template><p/></template>" + extra)).toThrow(DecaCompileError);
  }
  expect(() => parseForValueAlias("first, second")).toThrow(DecaCompileError);
});

test("static and bound attributes use the Ark setter for their tag", () => {
  const { app } = mountTemplate(
    '<input readonly type="CHECKBOX" v-model="checked"/><meter value="0.25"/><table><tr><td colspan="3"/></tr></table><button :disabled="rows.length" :data-id="id" :value="id"/><p spellcheck="false">{{id /* ok */}}</p>',
    { checked: true, rows: [0], id: 42 },
  );
  expect(app.querySelector("input")!.checked).toBe(true);
  expect(app.querySelector("input")!.readOnly).toBe(true);
  expect(app.querySelector("meter")!.value).toBe(0.25);
  expect(app.querySelector("td")!.colSpan).toBe(3);
  expect(app.querySelector("button")!.disabled).toBe(true);
  expect(app.querySelector("button")!.value).toBe("42");
  expect(app.querySelector("button")!.dataset.id).toBe("42");
  expect(app.querySelector("p")!.textContent).toBe("42");
});

test("the host applies declarative event modifiers", () => {
  let handled = 0,
    bubbled = 0;
  const { app } = mountTemplate('<button @click.prevent.stop="handle"/>', { handle: () => handled++ });
  app.addEventListener("click", () => bubbled++);
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  app.querySelector("button")!.dispatchEvent(event);
  expect([handled, bubbled, event.defaultPrevented]).toEqual([1, 0, true]);
});

test("option changes reselect the model, including a reused keyed option", () => {
  const rows = signal([{ id: 1, label: "a" }]);
  const { app } = mountTemplate(
    '<select v-model="selected"><option v-for="r in rows" :key="r.id" :value="r.label">{{r.label}}</option></select>',
    { rows, selected: "b" },
  );
  rows.value = [
    { id: 1, label: "a" },
    { id: 2, label: "b" },
  ];
  const select = app.querySelector("select")!;
  expect(select.value).toBe("b");
  rows.value = [
    { id: 1, label: "b" },
    { id: 2, label: "c" },
  ];
  expect(select.selectedIndex).toBe(0);
});

test("style updates restore the base and remove missing properties", () => {
  const styles = signal<Record<string, string>>({ color: "blue", fontSize: "12px" });
  const { app } = mountTemplate('<p style="color:red" :style="styles"/>', { styles });
  const p = app.querySelector("p")!;
  expect(p.style.color).toBe("blue");
  styles.value = {};
  expect([p.style.color, p.style.fontSize]).toEqual(["red", ""]);
});

test("sibling mounts share a sheet until its last owner disposes", () => {
  const Comp = { setup: () => ({}), render: compileRender("<p/>", ["p{color:cyan}"]) };
  const { gui } = freshApp();
  const sheets = () =>
    [...document.head.querySelectorAll("style")].filter((s) => s.textContent === "p{color:cyan}").length;
  const baseline = sheets();
  const first = createApp(Comp).mount(gui),
    second = createApp(Comp).mount(gui);
  expect(sheets()).toBe(baseline + 1);
  first();
  expect(sheets()).toBe(baseline + 1);
  second();
  expect(sheets()).toBe(baseline);
  let failure;
  try {
    createApp(Comp).mount(freshApp({ allowStylesheet: false }).gui);
  } catch (e) {
    failure = e;
  }
  expect(failure).toMatchObject({ code: "POLICY_DENIED" });
});

test("the live outlet owns a slot component with the author's provide lineage", () => {
  let unmounts = 0;
  const shown = signal(true);
  const Leaf = {
    setup() {
      onUnmounted(() => unmounts++);
      return { label: inject("label") };
    },
    render: compileRender("<b>{{label}}</b>"),
  };
  const Child = {
    setup() {
      provide("label", "child");
      return { shown };
    },
    render: compileRender("<slot v-if='shown'/>"),
  };
  const Parent = {
    setup() {
      provide("label", "author");
      return { Leaf, Child };
    },
    render: compileRender("<Child><Leaf/></Child>"),
  };
  const { gui, app } = freshApp();
  const stop = createApp(Parent).mount(gui);
  expect(app.textContent).toBe("author");
  shown.value = false;
  expect([unmounts, app.textContent]).toEqual([1, ""]);
  shown.value = true;
  expect(app.textContent).toBe("author");
  stop();
  stop();
  expect(unmounts).toBe(2);
});

test("failed mount rolls back listeners, sheets, effects, and pending mounted hooks", () => {
  const { gui, app } = freshApp();
  const sentinel = app.appendChild(document.createElement("hr"));
  const log: string[] = [];
  const ok = signal(false);
  const Root = {
    setup() {
      onMounted(() => log.push("mounted"));
      onUnmounted(() => log.push("unmounted"));
      return { ok };
    },
    render: compileRender('<b/><input :tabindex="ok ? 0 : Infinity"/>', ["b{color:pink}"]),
  };
  expect(() => createApp(Root).mount(gui)).toThrow();
  expect(log).toEqual(["unmounted"]);
  expect([...app.childNodes]).toEqual([sentinel]);
  ok.value = true;
  const stop = createApp(Root).mount(gui);
  expect(log).toEqual(["unmounted", "mounted"]);
  stop();
  stop();
  expect([...app.childNodes]).toEqual([sentinel]);
});

test("prop factories are lazy per instance, and Function defaults retain identity", () => {
  let calls = 0;
  const fn = () => 1;
  const options = mergeDefaults(
    { item: Object, callback: Function },
    { item: () => ({ n: ++calls }), callback: fn },
  );
  let supplied: unknown = "supplied";
  const props = createProps({ item: () => supplied }, options);
  expect(props.item).toBe("supplied");
  supplied = undefined;
  const value = props.item;
  expect(props.item).toBe(value);
  expect(props.callback).toBe(fn);
  expect(createProps({}, options).item).not.toBe(value);
  expect(calls).toBe(2);
});

test("quoted CSS declarations survive a semicolon inside the value", () => {
  const { app } = mountTemplate(`<p style="font-family: 'a;b'; color: red"/>`, {});
  const style = app.querySelector("p")!.style;
  expect(style.fontFamily).toContain("a;b");
  expect(style.color).toBe("red");
});

test("an allowed sheet that rejects its CSS is released immediately", () => {
  const count = document.head.querySelectorAll("style").length;
  const { gui, app } = freshApp();
  const Root = { setup: () => ({}), render: compileRender("<p/>", ["a{background:url(x)}"]) };
  let error;
  try {
    createApp(Root).mount(gui);
  } catch (e) {
    error = e;
  }
  expect(error).toMatchObject({ code: "URL_DENIED" });
  expect(document.head.querySelectorAll("style").length).toBe(count);
  expect(app.childNodes.length).toBe(0);
});

test("a failed reactive row mount can be followed by a successful list update", () => {
  const rows = signal([1]);
  const Row = {
    setup(props: Record<string, unknown>) {
      onMounted(() => {
        if (props.id === 2) throw new Error("row failed");
      });
      return {};
    },
    render: compileRender("<b>{{id}}</b>"),
  };
  const { app } = mountTemplate('<Row v-for="r in rows" :id="r" :key="r"/>', { Row, rows });
  expect(() => {
    rows.value = [1, 2];
  }).toThrow("row failed");
  expect(app.querySelectorAll("b")).toHaveLength(0);
  rows.value = [3, 1];
  expect(app.textContent).toBe("31");
});

test("valid void siblings, literal closing-tag text, and source positions survive SFC parsing", () => {
  expect(
    compileSFC('<template><input readonly><p title="</input>">{{ "</br>" }}</p></template>'),
  ).toContain("setReadonly(true)");
  let error: unknown;
  try {
    compileSFC('<template>\n  <p/>\n  <div href="x"/>\n</template>');
  } catch (e) {
    error = e;
  }
  expect(error).toMatchObject({ loc: { start: { line: 3, column: 3 } } });
});

test("the Vite plugin transforms module queries and leaves asset queries to Vite", async () => {
  const { malkuth } = await import("../src/vite.ts");
  const transform = malkuth().transform;
  if (typeof transform !== "function") throw new Error("Expected a transform hook");
  const run = (id: string) => transform.call({} as never, "<template><p/></template>", id);
  expect(await run("Card.vue?version=2")).toMatchObject({
    code: expect.stringContaining("createParagraph"),
  });
  expect(await run("Card.vue?raw")).toBeNull();
  expect(await run("Card.vue?version=2&url")).toBeNull();
});
