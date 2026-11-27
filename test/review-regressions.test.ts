import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "acorn";
import {
  compileRender,
  compileSFC,
  freshApp,
  mountTemplate,
} from "./support.ts";
import { transpileScript } from "../src/compiler/script.ts";
import { DecaCompileError } from "../src/compiler/errors.ts";
import { malkuth } from "../src/vite.ts";
import {
  signal,
  watch,
  reactive,
  ref,
  inject,
  provide,
  onMounted,
  onUnmounted,
} from "../src/index.ts";
import * as runtime from "../src/runtime/index.ts";

function component(source: string, imports: Record<string, unknown> = {}) {
  const code = compileSFC(source);
  parse(code, { ecmaVersion: "latest", sourceType: "module" });
  const body = code
    .replace(
      /import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["'];?/g,
      (_, names, module) =>
        "const {" +
        names.replace(/ as /g, ": ") +
        "} = " +
        (module === "decagrammaton/runtime" ? "runtime;" : "imports;"),
    )
    .replace("export function", "function")
    .replace(/export default (\w+);/, "return $1;");
  return new Function("runtime", "imports", body)(
    runtime,
    imports,
  ) as runtime.ComponentModule;
}

test("destructured prop aliases respect loop and arrow scopes", () => {
  const Card =
    component(`<script setup lang="ts">const { label: title = "fallback" } = defineProps<{label?: string}>()</script>
    <template>{{title}}<b v-for="title in ['row']">{{title}}</b>{{['arrow'].map(title => title)[0]}}</template>`);
  const { gui, app } = freshApp();
  runtime.createApp(Card).mount(gui);
  expect(app.textContent).toBe("fallbackrowarrow");
});

async function checkPropsInvalidation(transitive: boolean) {
  const dir = mkdtempSync("/tmp/decagrammaton-");
  const file = resolve(dir, transitive ? "base.ts" : "props.ts");
  const id = resolve(dir, "Card.vue") + "?v=1";
  const source =
    '<script setup lang="ts">import type { Props } from "./props";defineProps<Props>()</script><template/>';
  const { transform, handleHotUpdate, watchChange } = malkuth();
  if (
    typeof transform !== "function" ||
    typeof handleHotUpdate !== "function" ||
    typeof watchChange !== "function"
  )
    throw Error("Missing Vite hooks");
  const watched = new Set<string>();
  const compile = () =>
    transform.call(
      { addWatchFile: (path: string) => watched.add(path) } as never,
      source,
      id,
    );
  const mod = { id };
  const invalidated = new Set();
  const moduleGraph = {
    getModuleById: (key: string) => (key === id ? mod : undefined),
    invalidateModule: (value: unknown) => invalidated.add(value),
  };
  try {
    if (transitive)
      writeFileSync(resolve(dir, "props.ts"), 'import type { Base } from "./base"; export interface Props extends Base {}');
    const name = transitive ? "Base" : "Props";
    writeFileSync(file, `export interface ${name} { first: number }`);
    expect(await compile()).toMatchObject({
      code: expect.stringContaining("first:"),
    });
    expect(watched.has(file)).toBe(true);
    writeFileSync(file, `export interface ${name} { second: boolean }`);
    const affected = await handleHotUpdate.call(
      {} as never,
      { file, modules: [], server: { moduleGraph } } as never,
    );
    expect(affected?.map((module) => module.id)).toEqual([id]);
    expect(invalidated.has(mod)).toBe(true);
    expect(await compile()).toMatchObject({
      code: expect.stringContaining("second:"),
    });
    writeFileSync(file, `export interface ${name} { third: string }`);
    await watchChange.call({} as never, file, { event: "update" });
    expect(await compile()).toMatchObject({
      code: expect.stringContaining("third:"),
    });
  } finally {
    rmSync(dir, { recursive: true });
  }
}

test("editing an imported props interface invalidates its Vite module and Vue type cache", () => checkPropsInvalidation(false));
test("editing an inherited interface refreshes the importing interface in both Vite hooks", () => checkPropsInvalidation(true));

test("escaped namespace import leaves the component name available for allocation", () => {
  const code = compileSFC(
    String.raw`<script setup>import * as __deca_component_\u005f from "pkg"</script><template/>`,
  );
  expect(() =>
    parse(code, { ecmaVersion: "latest", sourceType: "module" }),
  ).not.toThrow();
});

test("Vue helpers and authored calls resolve to their own imports", () => {
  const Card = component(
    `<script setup>
import { options as _defineComponent, defaults as _mergeDefaults } from "fixture";
defineOptions(_defineComponent())
const { title = "default" } = defineProps(["title"])
const extra = _mergeDefaults()
</script><template>{{title}}:{{extra}}</template>`,
    { options: () => ({}), defaults: () => "authored" },
  );
  const { app, gui } = freshApp();
  runtime.createApp(Card).mount(gui);
  expect(app.textContent).toBe("default:authored");
});

test("unsupported setup languages, emits, external styles and TS syntax fail during compilation", () => {
  for (const extra of [
    "<style src/>",
    "<script setup lang>const value = 0</script>",
    "<script setup>const emit = true ? defineEmits() : null</script>",
    "<script setup>const call = () => defineEmits()</script>",
    '<style src="./x.css"/>',
    ...["tsx", "jsx", "coffee"].map(
      (lang) => `<script setup lang="${lang}">const n = 1</script>`,
    ),
    '<script setup>defineEmits(["change"])</script>',
    '<script setup lang="ts">const emit = defineEmits<{ change: [] }>()</script>',
  ])
    expect(() => compileSFC("<template/>" + extra)).toThrow(DecaCompileError);
  expect(() => transpileScript("const = 1")).toThrow(DecaCompileError);
});

test("value expressions keep their grouping, including handlers and model targets", () => {
  const names: string[] = [];
  const value = signal("before");
  const Child = {
    setup: () => ({}),
    render: compileRender("<b>{{payload.b}}</b>"),
  };
  const { app } = mountTemplate(
    `<Child :payload="{ a: 1, b: 2 }"/><p v-if="{ active: true }">{{ 1, 2 }}</p>
    <i v-for="x in [1]" :key="{ id: x }"/><textarea :rows="2, 4"/><input v-model="(value)"/>
    <button @click="(run)"/><button @click="(e => run(e))"/>`,
    { Child, value, run: () => names.push("run") },
  );
  expect(app.querySelector("b")!.textContent).toBe("2");
  expect(app.querySelector("p")!.textContent).toBe("2");
  expect(app.querySelector("i")).toBeTruthy();
  expect(app.querySelector("textarea")!.getAttribute("rows")).toBe("4");
  for (const button of app.querySelectorAll("button")) button.click();
  expect(names).toHaveLength(2);
  const input = app.querySelector("input")!;
  input.value = "after";
  input.dispatchEvent(new Event("input"));
  expect(value.value).toBe("after");
});

test("authored imports cannot capture attribute coercions", () => {
  const Card = component(
    `<script setup>import { trap as Boolean, trap as Number, trap as String } from "fixture"</script>
    <template><textarea :rows="4" :disabled="1" :title="5"/></template>`,
    {
      trap: () => {
        throw Error("captured");
      },
    },
  );
  const { gui, app } = freshApp();
  runtime.createApp(Card).mount(gui);
  const el = app.querySelector("textarea")!;
  expect([el.getAttribute("rows"), el.disabled, el.title]).toEqual([
    "4",
    true,
    "5",
  ]);
});

test("bare checkbox and radio values compare and write the empty string", () => {
  const checked = signal([""]),
    picked = signal("other");
  const { app } = mountTemplate(
    '<input type="checkbox" value v-model="checked"/><input type="radio" value v-model="picked"/>',
    { checked, picked },
  );
  const [box, radio] = app.querySelectorAll("input");
  expect(box.checked).toBe(true);
  box.checked = false;
  box.dispatchEvent(new Event("change"));
  radio.checked = true;
  radio.dispatchEvent(new Event("change"));
  expect([checked.value, picked.value]).toEqual([[], ""]);
});

for (const kind of ["if", "for"]) {
  const template =
    kind === "if"
      ? '<Child v-if="rows.length > 1" :id="2"/>'
      : '<Child v-for="id in rows" :key="id" :id="id"/>';
  test("mounted hook synchronously revises v-" + kind, () => {
    const rows = signal([1]);
    const Child = {
      setup(props: Record<string, unknown>) {
        onMounted(() => {
          if (props.id === 2) rows.value = kind === "if" ? [] : [1, 3];
        });
        return {};
      },
      render: compileRender("<b>{{id}}</b>"),
    };
    const { app } = mountTemplate(template, { Child, rows });
    rows.value = [1, 2];
    expect(app.textContent).toBe(kind === "if" ? "" : "13");
  });
  test(
    "failed v-" +
      kind +
      " mount preserves trigger and clears every partially mounted node",
    () => {
      let fail = true;
      const trigger = Error("mounted failure"),
        rows = signal([1]);
      const Child = {
        setup(props: Record<string, unknown>) {
          onMounted(() => {
            if (fail && props.id === 2) throw trigger;
          });
          onUnmounted(() => {
            if (fail) throw Error("cleanup failure");
          });
          return {};
        },
        render: compileRender("<b>{{id}}</b>"),
      };
      const { app } = mountTemplate(template, { Child, rows });
      expect(() => {
        rows.value = [1, 2, 3];
      }).toThrow(expect.objectContaining({ cause: trigger }));
      expect(app.querySelectorAll("b")).toHaveLength(0);
      fail = false;
      rows.value = [3, 4];
      expect(app.textContent).toBe(kind === "if" ? "2" : "34");
    },
  );
}

test("an app mounted from a hook has independent providers and lifetime", () => {
  const { gui, app } = freshApp();
  let stopChild!: () => void;
  const Child = {
    setup: () => ({ label: inject("label", "own") }),
    render: compileRender("<i>{{label}}</i>"),
  };
  const stopParent = runtime
    .createApp({
      setup() {
        provide("label", "parent");
        onMounted(() => {
          stopChild = runtime.createApp(Child).mount(gui);
        });
        return {};
      },
      render: compileRender("<b/>"),
    })
    .mount(gui);
  stopParent();
  expect(app.textContent).toBe("own");
  stopChild();
  expect(app.childNodes.length).toBe(0);
});

test("fragment wrapper retains prototype methods and their receiver", () => {
  const { gui } = freshApp();
  class Block {
    node = gui.createTextNode();
    first() {
      return this.node;
    }
    move() {
      this.node.setText("moved");
    }
  }
  const block = new Block();
  const fragment = runtime.mountFragment(() => block);
  expect(fragment.first()).toBe(block.node);
  fragment.move(gui);
  fragment.dispose();
});

test("declared props include defaults even for names on Object.prototype", () => {
  const { app, gui } = freshApp();
  runtime
    .createApp({
      props: { toString: { default: "safe" }, label: { default: "label" } },
      setup(props) {
        return {
          declared: "label" in props,
          inherited: "constructor" in props,
        };
      },
      render: compileRender("<b>{{toString}}:{{declared}}:{{inherited}}</b>"),
    })
    .mount(gui);
  expect(app.textContent).toBe("safe:true:false");
});

test("removing a longhand restores a shorthand; rejected overrides preserve valid declarations", () => {
  const styles = signal<Record<string, string>>({
    borderLeftColor: "blue",
    color: "url(x)",
  });
  const { app } = mountTemplate(
    '<p style="border-color:red;color:red" :style="styles"/>',
    { styles },
  );
  const { style } = app.querySelector("p")!;
  expect(style.color).toBe("red");
  expect(style.borderLeftColor).toBe("blue");
  styles.value = { color: "blue" };
  expect([style.borderLeftColor, style.color]).toEqual(["red", "blue"]);
  styles.value = { color: "url(x)" };
  expect(style.color).toBe("red");
});

for (const grouped of [false, true]) {
  test(
    "moving " +
      (grouped ? "an optgroup" : "an option") +
      " refreshes both select models",
    () => {
      const { app, gui } = freshApp();
      const selects = [gui.createSelect(), gui.createSelect()];
      const item = gui.createOption();
      const root = runtime.mountFragment(() => {
        for (const el of selects) {
          runtime.place(el, gui);
          runtime.prepareSelect(el);
          const option = gui.createOption();
          option.setValue("other");
          runtime.place(option, el);
        }
        item.setValue("chosen");
        const group = grouped ? gui.createOptgroup() : undefined;
        const moved = runtime.place(group ?? item, selects[0]);
        if (group) runtime.place(item, group);
        for (const el of selects) runtime.bindSelect(el, () => "chosen");
        return moved;
      });
      const [oldSelect, newSelect] = app.querySelectorAll("select");
      expect(oldSelect.value).toBe("chosen");
      root.move(selects[1]);
      expect([oldSelect.value, newSelect.value]).toEqual(["", "chosen"]);
      item.setValue("other");
      runtime.optionsChanged(item);
      expect(newSelect.selectedIndex).toBe(-1);
      root.dispose();
    },
  );
}

test("an Ark mount error survives a throwing scope cleanup", () => {
  const { gui, app } = freshApp();
  const Root = {
    setup() {
      onUnmounted(() => {
        throw Error("cleanup");
      });
      return {};
    },
    render: compileRender('<b/><input :tabindex="Infinity"/>'),
  };
  let error: unknown;
  try {
    runtime.createApp(Root).mount(gui);
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(AggregateError);
  expect((error as AggregateError).errors[0]).toMatchObject({
    code: expect.any(String),
  });
  expect(app.childNodes.length).toBe(0);
});

test("authored calls in component options retain their imported binding", () => {
  const Card = component(
    `<script setup lang="ts">
import { makeProps as _defineComponent } from "fixture";
defineProps(_defineComponent());
const label = (( _defineComponent: () => string ) => _defineComponent())(() => "local")
</script><template>{{title}}:{{label}}</template>`,
    {
      makeProps: () => ({ title: { default: "supplied" } }),
    },
  );
  const { gui, app } = freshApp();
  runtime.createApp(Card).mount(gui);
  expect(app.textContent).toBe("supplied:local");
});

test("a failed replacement also rolls back the previously visible branch", () => {
  const shown = signal(false);
  const Broken = {
    setup() {
      onUnmounted(() => {
        throw Error("cleanup");
      });
      return {};
    },
    render: compileRender('<i/><input :tabindex="Infinity"/>'),
  };
  const { app } = mountTemplate(
    '<Broken v-if="shown"/><b v-else>previous</b>',
    { shown, Broken },
  );
  expect(() => {
    shown.value = true;
  }).toThrow(AggregateError);
  expect(app.textContent).toBe("");
  shown.value = false;
  expect(app.textContent).toBe("previous");
});

test("a prop alias retains its source across a binding with the original name", () => {
  for (const extra of ["", 'const label = "setup";']) {
    const Card =
      component(`<script setup>const { label: title = "default" } = defineProps(["label"]);${extra}</script>
      <template><b v-for="label in ['row']">{{label}}:{{title}}:{{[0].map($props => title)[0]}}</b></template>`);
    const { gui, app } = freshApp();
    runtime.createApp(Card).mount(gui);
    expect(app.textContent).toBe("row:default:default");
  }
});

test("locally bound defineEmits inside a callback is callable", () => {
  const Card = component(
    "<script setup>const value = ((defineEmits) => defineEmits())(() => 42)</script><template>{{value}}</template>",
  );
  const { gui, app } = freshApp();
  runtime.createApp(Card).mount(gui);
  expect(app.textContent).toBe("42");
});

test("row watchers observe items belonging to their original keys during reentrant edits", () => {
  const rows = ref([
    { id: 1, rev: 0 },
    { id: 2, rev: 0 },
  ]);
  const seen: number[][] = [];
  const Child = {
    setup(props: Record<string, unknown>) {
      const item = () => props.item as { id: number; rev: number };
      const key = item().id;
      watch(
        item,
        (next) => {
          seen.push([key, next.id]);
          if (key === 1 && next.rev === 1) rows.value[1] = { id: 3, rev: 1 };
        },
        { flush: "sync" },
      );
      return {};
    },
    render: compileRender("<b>{{item.id}}</b>"),
  };
  const { app } = mountTemplate('<Child v-for="item in rows" :key="item.id" :item="item"/>', {
    rows,
    Child,
  });
  rows.value = [
    { id: 1, rev: 1 },
    { id: 2, rev: 1 },
  ];
  expect(app.textContent).toBe("13");
  expect(seen).toEqual([
    [1, 1],
    [2, 2],
  ]);
});

for (const directive of [
  'v-if="rows.length === 1"',
  'v-for="id in rows" :key="id"',
]) {
  test("unmount mutation skips reconciliation for " + directive, () => {
    const rows = signal([1]);
    let mounts = 0;
    const Child = {
      setup() {
        mounts++;
        onUnmounted(() => {
          rows.value = [2, 3];
        });
        return {};
      },
      render: compileRender("<i/>"),
    };
    const { app, scope } = mountTemplate(
      "<Child " +
        directive +
        "/>" +
        (directive.startsWith("v-if") ? "<Child v-else/>" : ""),
      { Child, rows },
    );
    scope.dispose();
    expect(app.childNodes.length).toBe(0);
    expect(mounts).toBe(1);
  });
}

test("a rejected dynamic style clears the previously accepted value", () => {
  const styles = signal({ color: "blue" });
  const { app } = mountTemplate('<p :style="styles"/>', { styles });
  const el = app.querySelector("p")!;
  expect(el.style.color).toBe("blue");
  styles.value = { color: "not-a-color" };
  expect(el.style.color).toBe("");
});

test("assignment through a template context cannot shadow a prop or its alias", () => {
  for (const name of ["label", "alias"]) {
    const Card = component(
      '<script setup>const { label: alias } = defineProps(["label"])</script><template>{{(' +
        name +
        " = 1)}}</template>",
    );
    const { gui } = freshApp();
    expect(() => runtime.createApp(Card, { label: 0 }).mount(gui)).toThrow(
      /read-only/,
    );
  }
});

test("grouped event assignment targets write identifiers and members", () => {
  const count = signal(0),
    form = reactive({ name: "" });
  const { app } = mountTemplate(
    '<button @click="(count) = 1"/><button @click="(form.name) = 2"/>',
    { count, form },
  );
  for (const button of app.querySelectorAll("button")) button.click();
  expect([count.value, form.name]).toEqual([1, 2]);
});

test("an authored undefined import cannot supply a nested insertion anchor", () => {
  const Card = component(
    '<script setup>import { trap as undefined } from "fixture"</script><template><div><b>nested</b></div></template>',
    { trap: {} },
  );
  const { gui, app } = freshApp();
  runtime.createApp(Card).mount(gui);
  expect(app.querySelector("div > b")?.textContent).toBe("nested");
});

test("loop aliases shadow globals in interpolations, handlers and model targets", () => {
  const rows = reactive([{ value: "row" }]);
  const { app } = mountTemplate(
    '<div v-for="Math in rows"><b>{{Math.value}}</b><button @click="Math.value = 1"/><input v-model="Math.value"/></div>',
    { rows },
  );
  expect(app.textContent).toBe("row");
  app.querySelector("button")!.click();
  expect(app.textContent).toBe("1");
  const input = app.querySelector("input")!;
  input.value = "edited";
  input.dispatchEvent(new Event("input"));
  expect(rows[0].value).toBe("edited");
});

test("structural updates stop when a sibling or a reused row triggers teardown", () => {
  const rows = signal<number[]>([]);
  let setups = 0;
  const Child = { setup() { setups++; return {}; }, render: compileRender("<i/>") };
  const Nested = {
    setup: () => ({ rows, Child }),
    render: compileRender('<Child v-if="rows.length"/><Child v-for="id in rows"/>'),
  };
  const Sibling = {
    setup() { onUnmounted(() => { rows.value = [1]; }); return {}; },
    render: compileRender("<b/>"),
  };
  const first = mountTemplate("<Nested/><Sibling/>", { Nested, Sibling });
  first.scope.dispose();
  expect(setups).toBe(0);
  expect(first.app.childNodes.length).toBe(0);

  rows.value = [1];
  let dispose!: () => void;
  const Row = {
    setup(props: Record<string, unknown>) {
      setups++;
      watch(() => props.item, () => dispose(), { flush: "sync" });
      return {};
    },
    render: compileRender("<b/>"),
  };
  const second = mountTemplate('<Row v-for="item in rows" :item="item"/>', { Row, rows });
  dispose = second.scope.dispose;
  rows.value = [2, 3];
  expect(setups).toBe(1);
  expect(second.app.childNodes.length).toBe(0);
});

test("declared props and setup bindings shadow allowed globals", () => {
  const script = '<script setup lang="ts">defineProps<{ Math: string }>(); const JSON = "setup"</script>';
  const { gui, app } = freshApp();
  runtime.createApp(component(script + '<template>{{Math}}:{{JSON}}:{{Number("4")}}</template>'), { Math: "prop" }).mount(gui);
  expect(app.textContent).toBe("prop:setup:4");
  const setter = component(script + '<template>{{Math = "changed"}}</template>');
  expect(() => runtime.createApp(setter, { Math: "prop" }).mount(gui)).toThrow(/read-only/);
  expect(mountTemplate("<b>{{Math.max(2, 4)}}</b>", {}).app.textContent).toBe("4");
});

test("TypeScript wrappers preserve defineEmits macro and local resolution", () => {
  for (const callee of ["defineEmits!", "(defineEmits as () => void)", "(defineEmits satisfies Function)", "(<Function>defineEmits)", "(defineEmits<string>)"]) {
    const source = (expr: string) => '<script setup lang="ts">const value = ' + expr + '</script><template>{{value}}</template>';
    expect(() => compileSFC(source(callee + "()"))).toThrow(DecaCompileError);
    const Card = component(source("((defineEmits: any) => " + callee + "())(() => 42)"));
    const { gui, app } = freshApp();
    runtime.createApp(Card).mount(gui);
    expect(app.textContent).toBe("42");
  }
});
