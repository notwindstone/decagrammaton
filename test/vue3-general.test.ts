import { test, expect, describe } from "bun:test";
import { mountTemplate } from "./support.ts";
import { signal } from "../src/reactivity.ts";

// ── Vue 3 Standard Template Usages (E2E) ─────────────────────────────────────
//
// These tests exercise common Vue 3 syntax patterns end-to-end. They validate
// that the acorn prefixer, codegen, and runtime context correctly collaborate
// when handling complex interpolations, nested structural directives, manual
// two-way bindings, and optional chaining inside real DOM nodes.

describe("Vue 3 template usages", () => {
  test("complex text interpolation with multiple bindings updates reactively", () => {
    const name = signal("Alice");
    const count = signal(5);
    const { app } = mountTemplate(
      `<p>Hello {{ name }}, you have {{ count }} messages.</p>`,
      { name, count }
    );
    const p = app.querySelector("p")!;

    expect(p.textContent).toBe("Hello Alice, you have 5 messages.");

    count.value = 10;
    expect(p.textContent).toBe("Hello Alice, you have 10 messages.");

    name.value = "Bob";
    expect(p.textContent).toBe("Hello Bob, you have 10 messages.");
  });

  test("v-if / v-else-if / v-else chain toggles branches correctly", () => {
    const status = signal("idle");
    const { app } = mountTemplate(
      `<div v-if="status === 'idle'">Idle</div><div v-else-if="status === 'loading'">Loading...</div><div v-else>Done</div>`,
      { status }
    );

    expect(app.textContent).toBe("Idle");

    status.value = "loading";
    expect(app.textContent).toBe("Loading...");

    status.value = "success";
    expect(app.textContent).toBe("Done");
  });

  test("manual two-way binding via :value and @input writes through _ctx", () => {
    const text = signal("initial");
    const { app } = mountTemplate(
      `<input :value="text" @input="text = $event.target.value" />`,
      { text }
    );
    const input = app.querySelector("input") as HTMLInputElement;

    expect(input.value).toBe("initial");

    // Simulate user typing
    input.value = "typed by user";
    input.dispatchEvent(new Event("input"));

    // The inline handler mutated the signal via the context set trap
    expect(text.value).toBe("typed by user");
  });

  test("nested v-for loops correctly resolve inner and outer aliased variables", () => {
    const matrix = signal([
      [{ id: 1, val: "A" }, { id: 2, val: "B" }],
      [{ id: 3, val: "C" }]
    ]);
    const { app } = mountTemplate(
      `<ul>
        <li v-for="(row, i) in matrix">
          <span v-for="(item, j) in row" :key="item.id">{{ i }}-{{ j }}: {{ item.id }}-{{ item.val }}</span>
        </li>
      </ul>`,
      { matrix }
    );

    const spans = app.querySelectorAll("span");
    expect(spans).toHaveLength(3);
    expect(spans[0].textContent).toBe("0-0: 1-A");
    expect(spans[1].textContent).toBe("0-1: 2-B");
    expect(spans[2].textContent).toBe("1-0: 3-C");
  });

  test("optional chaining and nullish coalescing evaluate safely in templates", () => {
    const state = signal<{ name?: string } | null>(null);
    const { app } = mountTemplate(
      `<div>{{ state?.name ?? "Loading..." }}</div>`,
      { state }
    );
    const div = app.querySelector("div")!;

    expect(div.textContent).toBe("Loading...");

    state.value = { name: "Ready" };
    expect(div.textContent).toBe("Ready");

    state.value = null;
    expect(div.textContent).toBe("Loading...");
  });

  test("inline statement handler with arithmetic updates the signal", () => {
    const count = signal(10);
    const { app } = mountTemplate(
      `<button @click="count = count * 2">Double</button>`,
      { count }
    );
    const btn = app.querySelector("button")!;

    btn.click();
    expect(count.value).toBe(20);

    btn.click();
    expect(count.value).toBe(40);
  });

  test("multiple root nodes (fragments) mount and patch independently", () => {
    const show = signal(true);
    const { app } = mountTemplate(
      `<span>Always</span><span v-if="show">Conditional</span>`,
      { show }
    );

    expect(app.querySelectorAll("span")).toHaveLength(2);
    expect(app.textContent).toBe("AlwaysConditional");

    show.value = false;
    expect(app.querySelectorAll("span")).toHaveLength(1);
    expect(app.textContent).toBe("Always");
  });

  test("v-model on a text input syncs state <-> DOM", () => {
    const text = signal("initial");
    const { app } = mountTemplate(`<input v-model="text" />`, { text });
    const input = app.querySelector("input") as HTMLInputElement;

    // State -> DOM (initial render)
    expect(input.value).toBe("initial");

    // State -> DOM (reactive update)
    text.value = "from-state";
    expect(input.value).toBe("from-state");

    // DOM -> State (user input)
    input.value = "from-dom";
    input.dispatchEvent(new Event("input"));
    expect(text.value).toBe("from-dom");
  });

  test("v-model on a textarea syncs state <-> DOM", () => {
    const text = signal("line1");
    const { app } = mountTemplate(`<textarea v-model="text"></textarea>`, { text });
    const textarea = app.querySelector("textarea") as HTMLTextAreaElement;

    expect(textarea.value).toBe("line1");

    text.value = "line2";
    expect(textarea.value).toBe("line2");

    textarea.value = "line3";
    textarea.dispatchEvent(new Event("input"));
    expect(text.value).toBe("line3");
  });

  test("v-model on a checkbox toggles boolean state", () => {
    const checked = signal(false);
    const { app } = mountTemplate(`<input type="checkbox" v-model="checked" />`, { checked });
    const input = app.querySelector("input") as HTMLInputElement;

    expect(input.checked).toBe(false);

    // State -> DOM
    checked.value = true;
    expect(input.checked).toBe(true);

    // DOM -> State
    input.checked = false;
    input.dispatchEvent(new Event("change"));
    expect(checked.value).toBe(false);
  });

  test("v-model with multiple checkboxes binds to an array", () => {
    // Vue 3 semantics: v-model on checkboxes with the same variable binds to an array
    const picked = signal<string[]>(["A"]);
    const { app } = mountTemplate(
      `<input type="checkbox" value="A" v-model="picked" />
       <input type="checkbox" value="B" v-model="picked" />`,
      { picked }
    );
    const [a, b] = app.querySelectorAll("input") as NodeListOf<HTMLInputElement>;

    expect(a.checked).toBe(true);
    expect(b.checked).toBe(false);

    // Check B
    b.checked = true;
    b.dispatchEvent(new Event("change"));
    expect(picked.value).toEqual(["A", "B"]);

    // Uncheck A
    a.checked = false;
    a.dispatchEvent(new Event("change"));
    expect(picked.value).toEqual(["B"]);
  });

  test("v-model on a select dropdown syncs state <-> DOM", () => {
    const selected = signal("apple");
    const { app } = mountTemplate(
      `<select v-model="selected">
        <option value="apple">Apple</option>
        <option value="banana">Banana</option>
      </select>`,
      { selected }
    );
    const select = app.querySelector("select") as HTMLSelectElement;
    const options = select.querySelectorAll("option");

    expect(select.value).toBe("apple");
    expect(options[0].selected).toBe(true);

    // State -> DOM
    selected.value = "banana";
    expect(select.value).toBe("banana");
    expect(options[1].selected).toBe(true);

    // DOM -> State
    select.value = "apple";
    select.dispatchEvent(new Event("change"));
    expect(selected.value).toBe("apple");
  });
});
