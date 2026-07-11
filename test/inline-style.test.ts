import "./support.ts";
import { describe, test, expect } from "bun:test";
import { renderSource, mountTemplate } from "./support.ts";
import { signal } from "../src/reactivity.ts";

// Inline style: `style="..."` and `:style="{ ... }"`. Neither is a one-arg ark
// setter — ark elements have no cssText sink (setCSS belongs to a <style>
// element). Both route to setStyle(el, value), which fans the value out over
// element.style's per-property allowlist proxy (unknown/url() props dropped).

describe("inline style — string layer (codegen)", () => {
  test("static style emits a setStyle call with the CSS string literal", () => {
    const src = renderSource(`<div style="color: red">x</div>`);
    expect(src).toContain(`setStyle(n0, "color: red");`);
    expect(src).not.toContain("setCSS");
  });

  test("dynamic :style wraps setStyle in a renderEffect, prefixed against _ctx", () => {
    const src = renderSource(`<div :style="{ color: c }">x</div>`);
    expect(src).toContain(`renderEffect(() => setStyle(n0, { color: _ctx.c }));`);
  });

  test("dynamic :style with a bound identifier prefixes it", () => {
    const src = renderSource(`<div :style="styles">x</div>`);
    expect(src).toContain(`renderEffect(() => setStyle(n0, _ctx.styles));`);
  });
});

describe("inline style — DOM end-to-end", () => {
  test("static string style sets individual whitelisted properties", () => {
    const { app } = mountTemplate(`<div style="color: red; background-color: blue">x</div>`, {});
    const div = app.querySelector("div") as HTMLElement;
    expect(div.style.color).toBe("red");
    expect(div.style.backgroundColor).toBe("blue");
  });

  test("dynamic object :style applies and reacts to a signal write", () => {
    const c = signal("red");
    const { app } = mountTemplate(`<div :style="{ color: c }">x</div>`, { c });
    const div = app.querySelector("div") as HTMLElement;
    expect(div.style.color).toBe("red");

    c.value = "green";
    expect(div.style.color).toBe("green");
  });

  test("array :style merges entries left-to-right (string + object)", () => {
    const { app } = mountTemplate(
      `<div :style="['color: red', { fontSize: '12px' }]">x</div>`,
      {},
    );
    const div = app.querySelector("div") as HTMLElement;
    expect(div.style.color).toBe("red");
    expect(div.style.fontSize).toBe("12px");
  });

  test("nullish :style is a no-op (no throw)", () => {
    const { app } = mountTemplate(`<div :style="maybe">x</div>`, { maybe: null });
    const div = app.querySelector("div") as HTMLElement;
    expect(div.getAttribute("style") ?? "").toBe("");
  });

  test("a non-whitelisted / url() property is dropped by ark's proxy", () => {
    const { app } = mountTemplate(
      `<div :style="{ color: 'red', behavior: 'url(x.htc)', background: 'url(x.png)' }">x</div>`,
      {},
    );
    const div = app.querySelector("div") as HTMLElement;
    expect(div.style.color).toBe("red"); // whitelisted, kept
    // `behavior` is not in ark's allowlist; `background` shorthand carries url().
    expect(div.style.getPropertyValue("behavior")).toBe("");
  });
});
