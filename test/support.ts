// Shared test support: register a happy-dom global document ONCE, and expose the
// helpers that turn a template string into something we can actually run — either
// its generated source (string-layer assertions) or a live render() executed
// against real runtime helpers + real ark nodes + real (happy-)DOM.
//
// Why happy-dom: every earlier iteration's tests stopped at the signal / codegen-
// string layer because the repo had no DOM, so "does this actually mount and
// update pixels" was punted to the user's browser. happy-dom closes that gap —
// ark-of-atrahasis drives the global `document`, so a real appendChild / click /
// textContent round-trips here. bun 1.1.38 chokes on happy-dom 20's `new Window()`
// (PropertySymbol.bindMethods), so we use the official global-registrator, which
// installs `document`/`window` on globalThis the way ark expects.
//
// IMPORTANT: import this module BEFORE ark-of-atrahasis anywhere it is used, so
// the global `document` exists when ark's module code first touches it.

import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Idempotent: multiple test files import this, but the DOM must register once.
if (!(globalThis as { __deca_dom__?: boolean }).__deca_dom__) {
  GlobalRegistrator.register();
  (globalThis as { __deca_dom__?: boolean }).__deca_dom__ = true;
}

import { createSafeDocument, type SafeDocument } from "ark-of-atrahasis";
import { parseTemplate } from "../src/compiler/parse.ts";
import { transform } from "../src/compiler/template/transform.ts";
import { generate } from "../src/compiler/template/codegen.ts";
import { compile } from "../src/compiler/compile.ts";
import * as runtime from "../src/runtime/index.ts";
import { createScope, runWithScope, type Scope } from "../src/reactivity.ts";
import { createContext } from "../src/runtime/helpers.ts";

// Full-SFC compile to a module source string, via the REAL compile() orchestrator.
// Needed for tests of behavior that only lives in compile.ts — chiefly the
// fail-loud <style scoped>/module/lang rejection, which the template-only
// renderSource path never sees.
export function compileSFC(source: string, filename = "Test.vue", id = "test"): string {
  return compile(source, filename, id);
}

// Template -> the exact source string codegen emits for render(). Used by the
// string-layer tests (whitelist throws, effect-wrapping shape, prefixing). An
// optional `styles` array is threaded straight into generate() so a test can
// assert the emitted mountStyle(gui, …) lines without a full SFC.
export function renderSource(template: string, styles: Array<string> = []): string {
  return generate(transform(parseTemplate(template)), styles);
}

// Reset the document to a single empty `#app` container and hand back a fresh
// ark SafeDocument bound to it. Call at the top of every DOM test.
export function freshApp(): { gui: SafeDocument; app: HTMLElement } {
  document.body.innerHTML = `<div id="app"></div>`;
  const gui = createSafeDocument("app");
  return { gui, app: document.getElementById("app") as HTMLElement };
}

// Compile a template to a LIVE render function, closing over the real runtime
// helpers exactly as the emitted module's `import { … } from "decagrammaton/
// runtime"` would. No hand-mirrored render body — this is the genuine codegen
// output executed, so a codegen regression fails the test.
export function compileRender(template: string, styles: Array<string> = []): (ctx: unknown, gui: SafeDocument) => unknown[] {
  const src = renderSource(template, styles).replace(/^export\s+function\s+render/, "function render");
  const make = new Function(
    "renderEffect", "on", "setText", "mountStyle", "setStyle", "normalizeClass", "append", "mountSlot",
    "createIf", "rootIf", "createFor", "rootFor", "createComponent", "toModelNumber", "modelArrayHas", "modelArrayToggle",
    `${src}\nreturn render;`,
  );
  return make(
    runtime.renderEffect, runtime.on, runtime.setText, runtime.mountStyle, runtime.setStyle, runtime.normalizeClass, runtime.append, runtime.mountSlot,
    runtime.createIf, runtime.rootIf, runtime.createFor, runtime.rootFor, runtime.createComponent, runtime.toModelNumber, runtime.modelArrayHas, runtime.modelArrayToggle,
  );
}

// End-to-end mount of a template against real DOM. `state` is the setup return
// (signals + methods); it is wrapped in the same createContext proxy the runtime
// uses, so `{{ count }}` unwraps and `count++` writes the signal. Returns the
// container plus the scope (dispose to tear the reactive tree down) so a test can
// assert teardown. Root-level v-if / v-for markers are bound against the
// container here, mirroring createApp.mount's own root loop.
export function mountTemplate(
  template: string,
  state: Record<string, unknown>,
  styles: Array<string> = [],
): { app: HTMLElement; gui: SafeDocument; scope: Scope; ctx: Record<string, unknown> } {
  const { gui, app } = freshApp();
  // The ark SafeElement for the container: appends must go through ark's own
  // appendChild (which unwraps to the real node), exactly like createApp.mount.
  const container = gui.getElement("app")!;
  const render = compileRender(template, styles);
  const ctx = createContext(state);
  const scope = createScope();
  runWithScope(scope, () => {
    const nodes = render(ctx, gui) as unknown[];
    for (const node of nodes) {
      if (runtime.isRootIf(node)) {
        container.appendChild(node.anchor);
        runtime.createIf(container as never, node.anchor as never, node.branches);
      } else if (runtime.isRootFor(node)) {
        container.appendChild(node.anchor);
        runtime.createFor(container as never, node.anchor as never, node.config);
      } else {
        container.appendChild(node as never);
      }
    }
  });
  return { app, gui, scope, ctx };
}
