import { test, expect, describe } from "bun:test";
import { renderSource, mountTemplate } from "./support.ts";
import { signal } from "../src/reactivity.ts";
import { DecaCompileError } from "../src/compiler/errors.ts";

// ── v-model (this slice) ─────────────────────────────────────────────────────
//
// v-model is COMPILE-TIME sugar with NO new runtime primitive: it lowers to a
// read renderEffect (state → DOM) plus a write on() handler (DOM → state) emitted
// against the element's own const. The write side reads the element back
// (getValue/getChecked) rather than `$event.target`, because ark's frozen
// SafeEvent exposes only `{ id, value }` — no `.checked`. That is why checkbox /
// radio work at all, and why v-model has to survive into codegen (only codegen
// knows the const name) instead of desugaring in transform.
//
// Two layers, matching the harness convention:
//   - string-layer: pin the emitted read/write shape + every fail-loud throw.
//   - DOM e2e: mount against real ark inputs in happy-dom and round-trip a real
//     input/change event through to the signal (and back).

describe("v-model codegen shape (string layer)", () => {
  test("text input: setValue read-effect + input write-back through the lvalue", () => {
    const src = renderSource(`<input v-model="text" />`);
    expect(src).toContain(`const n0 = gui.createInput();`);
    expect(src).toContain(`renderEffect(() => n0.setValue(String(_ctx.text ?? "")));`);
    expect(src).toContain(`on(n0, "input", () => { _ctx.text = n0.getValue(); });`);
  });

  test("textarea drives the same setValue/getValue pair on input", () => {
    const src = renderSource(`<textarea v-model="bio"></textarea>`);
    expect(src).toContain(`const n0 = gui.createTextarea();`);
    expect(src).toContain(`renderEffect(() => n0.setValue(String(_ctx.bio ?? "")));`);
    expect(src).toContain(`on(n0, "input", () => { _ctx.bio = n0.getValue(); });`);
  });

  test("select commits on CHANGE, not input (no per-keystroke event)", () => {
    const src = renderSource(`<select v-model="sel"><option value="a">A</option></select>`);
    expect(src).toContain(`const n0 = gui.createSelect();`);
    expect(src).toContain(`on(n0, "change", () => { _ctx.sel = n0.getValue(); });`);
    expect(src).not.toContain(`on(n0, "input"`);
  });

  test("checkbox binds checked <-> boolean on change", () => {
    const src = renderSource(`<input type="checkbox" v-model="agree" />`);
    expect(src).toContain(`renderEffect(() => n0.setChecked(!!_ctx.agree));`);
    expect(src).toContain(`on(n0, "change", () => { _ctx.agree = n0.getChecked(); });`);
  });

  test("checkbox WITH a static value binds an array (member <-> checked)", () => {
    const src = renderSource(`<input type="checkbox" value="A" v-model="picked" />`);
    expect(src).toContain(`renderEffect(() => n0.setChecked(modelArrayHas(_ctx.picked, "A")));`);
    expect(src).toContain(
      `on(n0, "change", () => { _ctx.picked = modelArrayToggle(_ctx.picked, "A", n0.getChecked()); });`,
    );
  });

  test("radio checks when model === its value and writes that value back", () => {
    const src = renderSource(`<input type="radio" value="a" v-model="picked" />`);
    expect(src).toContain(`renderEffect(() => n0.setChecked(_ctx.picked === "a"));`);
    expect(src).toContain(`on(n0, "change", () => { if (n0.getChecked()) _ctx.picked = "a"; });`);
  });

  test("a member lvalue prefixes correctly on both directions", () => {
    const src = renderSource(`<input v-model="form.name" />`);
    expect(src).toContain(`renderEffect(() => n0.setValue(String(_ctx.form.name ?? "")));`);
    expect(src).toContain(`on(n0, "input", () => { _ctx.form.name = n0.getValue(); });`);
  });
});

describe("v-model modifiers (string layer)", () => {
  test(".lazy switches a text input to the change event", () => {
    const src = renderSource(`<input v-model.lazy="x" />`);
    expect(src).toContain(`on(n0, "change", () => { _ctx.x = n0.getValue(); });`);
    expect(src).not.toContain(`on(n0, "input"`);
  });

  test(".number wraps the read-back in toModelNumber", () => {
    const src = renderSource(`<input v-model.number="n" />`);
    expect(src).toContain(`_ctx.n = toModelNumber(n0.getValue());`);
  });

  test(".trim trims the read-back", () => {
    const src = renderSource(`<input v-model.trim="s" />`);
    expect(src).toContain(`_ctx.s = n0.getValue().trim();`);
  });

  test(".number.trim compose in order: trim first, then coerce", () => {
    const src = renderSource(`<input v-model.number.trim="n" />`);
    expect(src).toContain(`_ctx.n = toModelNumber(n0.getValue().trim());`);
  });
});

describe("v-model fail-loud (whitelist / correctness)", () => {
  test("on a plain non-form element", () => {
    expect(() => renderSource(`<div v-model="x">y</div>`)).toThrow(DecaCompileError);
    expect(() => renderSource(`<div v-model="x">y</div>`)).toThrow(/only <input>, <textarea>, and <select>/);
  });

  test("on a component", () => {
    expect(() => renderSource(`<Child v-model="x" />`)).toThrow(/v-model on component/);
  });

  test("a named/argument model (v-model:foo)", () => {
    expect(() => renderSource(`<input v-model:foo="x" />`)).toThrow(/named\/component models/);
  });

  test("two v-models on one element", () => {
    // Distinct modifiers so baseParse doesn't reject as a duplicate ATTRIBUTE
    // first — this must reach our own "Multiple v-model" guard in transform.
    expect(() => renderSource(`<input v-model="a" v-model.lazy="b" />`)).toThrow(/Multiple v-model/);
  });

  test("a non-assignable target (a call expression)", () => {
    expect(() => renderSource(`<input v-model="get()" />`)).toThrow(/must be an assignable/);
  });

  test("a dynamic :type (kind cannot be chosen at build time)", () => {
    expect(() => renderSource(`<input :type="t" v-model="x" />`)).toThrow(/requires a static `type`/);
  });

  test(".number on a checkbox is meaningless", () => {
    expect(() => renderSource(`<input type="checkbox" v-model.number="b" />`)).toThrow(/meaningless on a checkbox/);
  });

  test("a radio without a value has nothing to select", () => {
    expect(() => renderSource(`<input type="radio" v-model="p" />`)).toThrow(/radio .* requires a static `value`/);
  });

  test("value competes with v-model on a text input", () => {
    expect(() => renderSource(`<input value="x" v-model="m" />`)).toThrow(/v-model owns the value/);
  });
});

// ── DOM end-to-end: real ark inputs in happy-dom, real input/change events ────

describe("v-model DOM e2e", () => {
  test("typing into a text input writes the signal, and an external write repaints", () => {
    const text = signal("hi");
    const { app } = mountTemplate(`<input v-model="text" />`, { text });
    const input = app.querySelector("input") as HTMLInputElement;

    // read direction: initial signal → DOM value
    expect(input.value).toBe("hi");

    // write direction: user types → input event → signal updates
    input.value = "world";
    input.dispatchEvent(new Event("input"));
    expect(text.value).toBe("world");

    // read direction again: external signal write → DOM repaints
    text.value = "external";
    expect(input.value).toBe("external");
  });

  test("checkbox toggles a boolean both ways", () => {
    const agree = signal(false);
    const { app } = mountTemplate(`<input type="checkbox" v-model="agree" />`, { agree });
    const box = app.querySelector("input") as HTMLInputElement;

    expect(box.checked).toBe(false);

    box.checked = true;
    box.dispatchEvent(new Event("change"));
    expect(agree.value).toBe(true);

    agree.value = false; // external → DOM
    expect(box.checked).toBe(false);
  });

  test("checkbox group with values binds an array (add/remove members, fresh ref)", () => {
    const picked = signal<string[]>(["A"]);
    const { app } = mountTemplate(
      `<div><input type="checkbox" value="A" v-model="picked" /><input type="checkbox" value="B" v-model="picked" /></div>`,
      { picked },
    );
    const [a, b] = Array.from(app.querySelectorAll("input")) as HTMLInputElement[];

    // read: a box is checked iff its value is a member of the model array
    expect(a.checked).toBe(true);
    expect(b.checked).toBe(false);

    // write: checking B produces a NEW array containing both
    const before = picked.value;
    b.checked = true;
    b.dispatchEvent(new Event("change"));
    expect(picked.value).toEqual(["A", "B"]);
    expect(picked.value).not.toBe(before); // fresh reference, or the signal wouldn't fire

    // write: unchecking A removes just that member
    a.checked = false;
    a.dispatchEvent(new Event("change"));
    expect(picked.value).toEqual(["B"]);

    // read direction again: an external array write repaints both boxes
    picked.value = ["A"];
    expect(a.checked).toBe(true);
    expect(b.checked).toBe(false);
  });

  test("radio group selects by value and reflects the model", () => {
    const picked = signal("b");
    const { app } = mountTemplate(
      `<div><input type="radio" value="a" v-model="picked" /><input type="radio" value="b" v-model="picked" /></div>`,
      { picked },
    );
    const [a, b] = Array.from(app.querySelectorAll("input")) as HTMLInputElement[];

    // read: only the radio whose value equals the model is checked
    expect(a.checked).toBe(false);
    expect(b.checked).toBe(true);

    // write: picking "a" sets the model, which repaints both radios
    a.checked = true;
    a.dispatchEvent(new Event("change"));
    expect(picked.value).toBe("a");
    expect(a.checked).toBe(true);
    expect(b.checked).toBe(false);
  });

  test(".number coerces a numeric string, leaves a non-numeric one as a string", () => {
    const n = signal<string | number>(0);
    const { app } = mountTemplate(`<input v-model.number="n" />`, { n });
    const input = app.querySelector("input") as HTMLInputElement;

    input.value = "42";
    input.dispatchEvent(new Event("input"));
    expect(n.value).toBe(42);

    input.value = "not-a-number";
    input.dispatchEvent(new Event("input"));
    expect(n.value).toBe("not-a-number"); // toModelNumber returns the raw string on NaN
  });

  test(".trim strips surrounding whitespace on write-back", () => {
    const s = signal("");
    const { app } = mountTemplate(`<input v-model.trim="s" />`, { s });
    const input = app.querySelector("input") as HTMLInputElement;

    input.value = "  spaced  ";
    input.dispatchEvent(new Event("input"));
    expect(s.value).toBe("spaced");
  });

  test(".lazy commits on change, ignoring intermediate input events", () => {
    const x = signal("");
    const { app } = mountTemplate(`<input v-model.lazy="x" />`, { x });
    const input = app.querySelector("input") as HTMLInputElement;

    input.value = "typing";
    input.dispatchEvent(new Event("input")); // lazy binds change, so input is ignored
    expect(x.value).toBe("");

    input.dispatchEvent(new Event("change"));
    expect(x.value).toBe("typing");
  });

  test("select binds the chosen option value on change", () => {
    const sel = signal("b");
    const { app } = mountTemplate(
      `<select v-model="sel"><option value="a">A</option><option value="b">B</option></select>`,
      { sel },
    );
    const select = app.querySelector("select") as HTMLSelectElement;

    expect(select.value).toBe("b"); // read: initial model

    select.value = "a";
    select.dispatchEvent(new Event("change"));
    expect(sel.value).toBe("a");
  });

  test("disposing the scope stops v-model write-back", () => {
    // Proven-red guard: the on() cleanup is scope-bound (helpers.on → onDispose),
    // so after dispose a DOM event must NOT reach the signal. If the handler
    // leaked past teardown this would flip to "typed".
    const text = signal("start");
    const { app, scope } = mountTemplate(`<input v-model="text" />`, { text });
    const input = app.querySelector("input") as HTMLInputElement;

    scope.dispose();
    input.value = "typed";
    input.dispatchEvent(new Event("input"));
    expect(text.value).toBe("start");
  });
});
