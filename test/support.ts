import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!(globalThis as { __deca_dom__?: boolean }).__deca_dom__) {
  GlobalRegistrator.register();
  (globalThis as { __deca_dom__?: boolean }).__deca_dom__ = true;
}

import { createSafeDocument } from "ark-of-atrahasis";
import { parseTemplate } from "../src/compiler/parse.ts";
import { transform } from "../src/compiler/template/transform.ts";
import { generate } from "../src/compiler/template/codegen.ts";
import { compile } from "../src/compiler/compile.ts";
import * as runtime from "../src/runtime/index.ts";



export function compileSFC(source: string, filename = "Test.vue", id = "test"): string {
  return compile(source, filename, id);
}

export function renderSource(template: string, styles: Array<string> = []): string {
  return generate(transform(parseTemplate(template)), styles);
}

export function freshApp(options = {}) {
  document.body.innerHTML = '<div id="app"></div>';
  const app = document.getElementById("app")!;
  return { gui: createSafeDocument(app, { allowStylesheet: true, ...options }), app };
}
export function compileRender(template: string, styles: string[] = []): runtime.ComponentModule["render"] {
  const body = renderSource(template, styles).replace("export function render", "function render");
  return new Function(...Object.keys(runtime), body + "\nreturn render;")(...Object.values(runtime));
}
export function mountTemplate(template: string, state: Record<string, unknown>, styles: string[] = []) {
  const { gui, app } = freshApp();
  const dispose = runtime.createApp({ setup: () => state, render: compileRender(template, styles) }).mount(gui);
  return { app, gui, scope: { dispose } };
}
