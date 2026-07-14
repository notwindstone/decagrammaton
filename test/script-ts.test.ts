import "./support.ts";
import { describe, test, expect } from "bun:test";
import { compileSFC, freshApp } from "./support.ts";
import { transpileScript, compileSetup } from "../src/compiler/script.ts";
import { parseSFC } from "../src/compiler/parse.ts";
import * as runtime from "../src/runtime/index.ts";
import { createApp } from "../src/runtime/component.ts";
import { ref } from "../src/reactivity.ts";

// ── TypeScript <script setup lang="ts"> ──────────────────────────────────────
//
// The compiler front-end (acorn for template expressions, @babel/parser inside
// @vue/compiler-sfc's rewriteDefault) is JS-only. A `<script setup lang="ts">`
// body carrying `interface` / `: T` annotations / `ref<T>()` type args used to
// crash the build ("Unexpected reserved word 'interface'"). script.ts now
// transpiles the TS body to plain JS up front, so the whole pipeline sees JS.
//
// Two things must hold: types are erased (nothing TS survives into the emitted
// module) and the module stays wired to decagrammaton — NOT to `vue`. Vue's own
// TS path rewrites the component to `_defineComponent(...)` and injects
// `import { defineComponent } from 'vue'`, which is unresolvable in an SES
// compartment; transpiling first keeps compileScript on its untyped branch.

describe("transpileScript — the raw TS→JS unit", () => {
  test("strips interfaces, type annotations, and generic type args", () => {
    const js = transpileScript(
      `interface Foo { x: number }\n` +
        `const label: string = "hi";\n` +
        `const n = ref<number>(0);\n` +
        `function inc(): void { n.value++; }`,
    );
    expect(js).not.toContain("interface");
    expect(js).not.toContain(": string");
    expect(js).not.toContain(": void");
    expect(js).not.toContain("<number>");
    // The runtime code survives.
    expect(js).toContain(`const label = "hi"`);
    expect(js).toContain("n.value++");
  });

  test("preserves imports even when only referenced from the template", () => {
    // verbatimModuleSyntax keeps `ref` — TS would otherwise elide it as unused,
    // since the template (not the script body) is what references it.
    const js = transpileScript(`import { ref } from "decagrammaton";`);
    expect(js).toContain(`import { ref } from "decagrammaton"`);
  });

  test("type-only import + a value import both handled", () => {
    const js = transpileScript(
      `import { ref } from "decagrammaton";\n` +
        `import type { Ref } from "decagrammaton";\n` +
        `const n = ref(0);`,
    );
    expect(js).toContain(`import { ref } from "decagrammaton"`);
    // A pure `import type` is dropped (it has no runtime meaning).
    expect(js).not.toContain("import type");
    expect(js).not.toContain("{ Ref }");
  });
});

describe("compileSetup — lowering a TS <script setup>", () => {
  test("a TS block compiles without throwing and emits no TS syntax", () => {
    const descriptor = parseSFC(
      `<script setup lang="ts">\n` +
        `import { ref } from "decagrammaton";\n` +
        `interface Counter { n: number }\n` +
        `const count = ref<number>(0);\n` +
        `const inc = (): void => { count.value++; };\n` +
        `</script>\n` +
        `<template><button @click="inc">{{ count }}</button></template>`,
      "T.vue",
    );
    const { content } = compileSetup(descriptor, "test");
    expect(content).not.toContain("interface");
    expect(content).not.toContain(": void");
    expect(content).not.toContain("<number>");
  });

  test("does NOT inject an import from 'vue' (stays SES-safe)", () => {
    const descriptor = parseSFC(
      `<script setup lang="ts">\nconst count = ref<number>(0);\n</script>\n` +
        `<template><p>{{ count }}</p></template>`,
      "T.vue",
    );
    const { content } = compileSetup(descriptor, "test");
    expect(content).not.toContain("defineComponent");
    expect(content).not.toContain("from 'vue'");
    expect(content).not.toContain('from "vue"');
  });

  test("the component const is still bound to __deca_component__", () => {
    const descriptor = parseSFC(
      `<script setup lang="ts">\nconst x: number = 1;\n</script>\n` +
        `<template><p>{{ x }}</p></template>`,
      "T.vue",
    );
    const { content, bindingName } = compileSetup(descriptor, "test");
    expect(bindingName).toBe("__deca_component__");
    expect(content).toContain("const __deca_component__ =");
  });

  test("a plain (non-TS) <script setup> is untouched by the TS path", () => {
    const descriptor = parseSFC(
      `<script setup>\nconst count = ref(0);\n</script>\n` +
        `<template><p>{{ count }}</p></template>`,
      "T.vue",
    );
    const { content } = compileSetup(descriptor, "test");
    expect(content).toContain("const count = ref(0)");
  });
});

describe("compile() — full SFC with TS", () => {
  test("a TS SFC produces a runnable module wired to decagrammaton/runtime", () => {
    const mod = compileSFC(
      `<script setup lang="ts">\n` +
        `import { ref } from "decagrammaton";\n` +
        `const count = ref<number>(0);\n` +
        `function inc(): void { count.value++; }\n` +
        `</script>\n` +
        `<template><button @click="inc">{{ count }}</button></template>`,
      "T.vue",
    );
    expect(mod).toContain(`from "decagrammaton/runtime"`);
    expect(mod).toContain("export default __deca_component__");
    expect(mod).not.toContain("interface");
    expect(mod).not.toContain(": void");
    // The template still compiled around the TS script.
    expect(mod).toContain("gui.createButton()");
  });
});

describe("TS SFC — live behavior against real DOM", () => {
  // Compile a full TS SFC to a module STRING, then evaluate that string with the
  // runtime + reactivity injected (the same shape support.ts's compileRender uses,
  // but here the whole module runs — setup + render — so the erased TS body is
  // genuinely executed, not bypassed). Proves the transpiled `ref<number>()` /
  // typed handler behave exactly like their JS twins end to end.
  test("a TS-typed counter increments reactively", () => {
    const src = compileSFC(
      `<script setup lang="ts">\n` +
        `import { ref } from "decagrammaton";\n` +
        `const count = ref<number>(0);\n` +
        `const inc = (): void => { count.value++; };\n` +
        `</script>\n` +
        `<template><button @click="inc">{{ count }}</button></template>`,
      "Counter.vue",
    );

    // Rewrite the two bare imports to the injected locals, then eval the module
    // body and hand back its default export (the component module).
    const body = src
      .replace(/import\s+\{[^}]*\}\s+from\s+"decagrammaton\/runtime";/, "")
      .replace(/import\s+\{\s*ref\s*\}\s+from\s+"decagrammaton";/, "")
      .replace(/^export\s+function\s+render/m, "function render")
      .replace(/export default (\w+);?/, "return $1;");

    const make = new Function(
      "renderEffect", "on", "setText", "mountStyle", "setStyle", "normalizeClass", "append", "appendAll", "mountSlot",
      "createIf", "rootIf", "createFor", "rootFor", "createComponent", "toModelNumber", "modelArrayHas", "modelArrayToggle",
      "ref",
      body,
    );
    const module = make(
      runtime.renderEffect, runtime.on, runtime.setText, runtime.mountStyle, runtime.setStyle, runtime.normalizeClass, runtime.append, runtime.appendAll, runtime.mountSlot,
      runtime.createIf, runtime.rootIf, runtime.createFor, runtime.rootFor, runtime.createComponent, runtime.toModelNumber, runtime.modelArrayHas, runtime.modelArrayToggle,
      ref,
    );

    const { gui, app } = freshApp();
    const container = gui.getElement("app")!;
    createApp(module).mount(container as never, gui);

    const button = app.querySelector("button") as HTMLButtonElement;
    expect(button.textContent).toBe("0");
    button.click();
    expect(button.textContent).toBe("1");
  });
});
