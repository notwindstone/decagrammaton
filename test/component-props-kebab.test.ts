import { test, expect } from "bun:test";
import { freshApp, compileRender } from "./support.ts";
import { signal, createScope, runWithScope } from "../src/reactivity.ts";
import { createContext } from "../src/runtime/helpers.ts";
import { createInstance, runWithInstance } from "../src/runtime/instance.ts";
import type { SafeDocument } from "ark-of-atrahasis";

// A parent that binds kebab-case attributes on a child (`attribute-name`,
// `:other-prop`) must resolve them to the child's camelCase props
// (`attributeName`, `otherProp`) — Vue's attribute-name normalisation. Before the
// codegen camelise, the emitted getter key was the raw kebab string, so the
// child's `_ctx.attributeName` lookup missed and read `undefined`.

function mountWithChild(parentTemplate: string, childTemplate: string, state: Record<string, unknown>) {
  const { gui, app } = freshApp();
  const container = gui.getElement("app")!;

  const childRender = compileRender(childTemplate);
  const childModule = {
    setup() {
      // Return nothing: the child reads `{{ attributeName }}` -> `_ctx.attributeName`,
      // which falls through createContext's props layer to the parent's camelised
      // getter (reactive). Spreading props here would snapshot values and break that.
      return {};
    },
    render(ctx: Record<string, unknown>, g: SafeDocument) {
      return childRender(ctx, g) as unknown[];
    },
  };

  const parentRender = compileRender(parentTemplate);
  const scope = createScope();
  const instance = createInstance(null);
  runWithScope(scope, () => {
    runWithInstance(instance, () => {
      const ctx = createContext({ ...state, Child: childModule });
      const nodes = parentRender(ctx, gui) as unknown[];
      for (const node of nodes) container.appendChild(node as never);
    });
  });
  return { app };
}

test("static kebab attribute resolves to a camelCase prop in the child", () => {
  const { app } = mountWithChild(
    `<div><Child attribute-name="hello" /></div>`,
    `<p>{{ attributeName }}</p>`,
    {},
  );
  expect(app.querySelector("p")?.textContent).toBe("hello");
});

test("dynamic kebab prop stays reactive under its camelCase name", () => {
  const label = signal("first");
  const { app } = mountWithChild(
    `<div><Child :other-prop="label" /></div>`,
    `<p>{{ otherProp }}</p>`,
    { label },
  );
  expect(app.querySelector("p")?.textContent).toBe("first");

  label.value = "second"; // parent signal -> camelised prop getter -> child re-renders
  expect(app.querySelector("p")?.textContent).toBe("second");
});
