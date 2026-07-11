import "./support.ts";
import { describe, test, expect } from "bun:test";
import { DecaCompileError } from "../src/compiler/errors.ts";
import { renderSource, compileSFC, mountTemplate } from "./support.ts";

// <style> support: plain global <style> blocks compile to mountStyle(gui, css)
// lines at the top of render(), inserted per instance and removed on scope
// teardown. scoped / module / non-css lang are rejected fail-loud in compile.ts.

describe("<style> — string layer (codegen)", () => {
  test("a style block emits mountStyle(gui, css) before any node", () => {
    const src = renderSource(`<p>hi</p>`, ["p{color:red}"]);
    expect(src).toContain(`mountStyle(gui, "p{color:red}");`);
    // It precedes the first node creation in the body.
    const styleAt = src.indexOf("mountStyle(gui,");
    const nodeAt = src.indexOf("const n0");
    expect(styleAt).toBeGreaterThanOrEqual(0);
    expect(nodeAt).toBeGreaterThan(styleAt);
  });

  test("no style blocks -> no mountStyle line (existing callers unaffected)", () => {
    const src = renderSource(`<p>hi</p>`);
    expect(src).not.toContain("mountStyle");
  });

  test("multiple blocks emit one line each, in order", () => {
    const src = renderSource(`<p>hi</p>`, ["a{}", "b{}"]);
    const first = src.indexOf(`mountStyle(gui, "a{}");`);
    const second = src.indexOf(`mountStyle(gui, "b{}");`);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(second).toBeGreaterThan(first);
  });

  test("quotes and newlines in CSS survive as an escaped literal", () => {
    const css = `a::before{content:"x"}\np{color:blue}`;
    const src = renderSource(`<p>hi</p>`, [css]);
    // The emitted literal round-trips back to the exact CSS via JSON.parse.
    const match = src.match(/mountStyle\(gui, (".*?")\);/s);
    expect(match).not.toBeNull();
    expect(JSON.parse(match![1])).toBe(css);
  });
});

describe("<style> — compile() layer (full SFC)", () => {
  test("a plain global <style> compiles to the import + a mountStyle call", () => {
    const mod = compileSFC(
      `<template><p>hi</p></template>\n<style>p{color:red}</style>`,
    );
    expect(mod).toContain("mountStyle");
    // Imported from the runtime and called in the body.
    expect(mod).toContain(`from "decagrammaton/runtime"`);
    expect(mod).toContain(`mountStyle(gui, "p{color:red}");`);
  });

  test("no <style> -> no mountStyle in the emitted module", () => {
    const mod = compileSFC(`<template><p>hi</p></template>`);
    expect(mod).not.toContain("mountStyle(gui,");
  });
});

describe("<style> — fail-loud rejections", () => {
  test("<style scoped> throws DecaCompileError", () => {
    expect(() =>
      compileSFC(`<template><p>hi</p></template>\n<style scoped>p{color:red}</style>`),
    ).toThrow(DecaCompileError);
    expect(() =>
      compileSFC(`<template><p>hi</p></template>\n<style scoped>p{color:red}</style>`),
    ).toThrow(/scoped/);
  });

  test("<style module> throws DecaCompileError", () => {
    expect(() =>
      compileSFC(`<template><p>hi</p></template>\n<style module>p{color:red}</style>`),
    ).toThrow(DecaCompileError);
    expect(() =>
      compileSFC(`<template><p>hi</p></template>\n<style module>p{color:red}</style>`),
    ).toThrow(/module/);
  });

  test('<style lang="scss"> throws DecaCompileError', () => {
    expect(() =>
      compileSFC(`<template><p>hi</p></template>\n<style lang="scss">p{color:red}</style>`),
    ).toThrow(DecaCompileError);
    expect(() =>
      compileSFC(`<template><p>hi</p></template>\n<style lang="scss">p{color:red}</style>`),
    ).toThrow(/scss/);
  });
});

describe("<style> — DOM end-to-end", () => {
  // Snapshot the <style> nodes ark appends to document.head, so we can tell ours
  // apart from any left by earlier tests.
  function headStyles(): Array<string> {
    return Array.from(document.head.querySelectorAll("style")).map((s) => s.textContent ?? "");
  }

  test("mount inserts the CSS into document.head; dispose removes it", () => {
    const css = "p{color:rgb(1,2,3)}";
    const before = headStyles();
    const { scope } = mountTemplate(`<p>hi</p>`, {}, [css]);

    const afterMount = headStyles();
    expect(afterMount).toContain(css);
    // Exactly one new style node carrying our CSS.
    expect(afterMount.filter((c) => c === css).length).toBe(before.filter((c) => c === css).length + 1);

    scope.dispose();
    const afterDispose = headStyles();
    expect(afterDispose.filter((c) => c === css).length).toBe(before.filter((c) => c === css).length);
  });
});
