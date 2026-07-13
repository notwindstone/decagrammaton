import { test, expect } from "bun:test";
import { freshApp, compileRender } from "./support.ts";
import { signal, computed, createScope, runWithScope } from "../src/reactivity.ts";
import { createContext } from "../src/runtime/helpers.ts";
import { createInstance, runWithInstance } from "../src/runtime/instance.ts";
import type { SafeDocument } from "ark-of-atrahasis";

// Regression: the TestParent -> Test crash.
//
// A parent v-model write flushes synchronously; the write flows through a prop
// getter into a CHILD computed (`filteredData`) that feeds BOTH a
// `v-if="filteredData.length"` and an unkeyed `v-for="entry in filteredData"`.
//
// The old `updateRow` read+wrote each reused row's item signal while the LIST
// effect was still the active subscriber. That (a) subscribed the list effect to
// every row's signal and (b) made the write synchronously re-enter the list
// effect mid-reconcile (sigrea's unbatched sync flush) — reassigning `oldBlocks`
// to the shorter array so the outer body's unmount loop dereferenced `undefined`:
//   "can't access property 'scope', row is undefined" at unmountRow.
// updateRow now runs untracked, severing both the spurious dep and the re-entry.

function mountPair(childTemplate: string) {
  const { gui, app } = freshApp();
  const container = gui.getElement("app")!;

  const childRender = compileRender(childTemplate);
  const data = [
    { name: "Chuck Norris" },
    { name: "Bruce Lee" },
    { name: "Jackie Chan" },
    { name: "Jet Li" },
  ];
  const childModule = {
    setup(props: Record<string, unknown>) {
      const filteredData = computed(() => {
        const q = String((props as { filterKey?: unknown }).filterKey ?? "").toLowerCase();
        return q ? data.filter((r) => r.name.toLowerCase().includes(q)) : data;
      });
      return { filteredData };
    },
    render(ctx: Record<string, unknown>, g: SafeDocument) {
      return childRender(ctx, g) as unknown[];
    },
  };

  const query = signal("");
  const parentRender = compileRender(
    `<div><input v-model="query" /><Child :filterKey="query" /></div>`,
  );

  const scope = createScope();
  const instance = createInstance(null);
  runWithScope(scope, () => {
    runWithInstance(instance, () => {
      const ctx = createContext({ query, Child: childModule });
      const nodes = parentRender(ctx, gui) as unknown[];
      for (const node of nodes) container.appendChild(node as never);
    });
  });

  const input = app.querySelector("input") as HTMLInputElement;
  // Drive the parent signal DIRECTLY (not via dispatchEvent): happy-dom's
  // dispatchEvent swallows listener throws into window.onerror, which would hide
  // the re-entrancy crash. A direct `query.value = …` sync-flushes the same way a
  // real input does, but the throw propagates to the assertion so the test can
  // actually fail on regression.
  const type = (v: string) => {
    query.value = v;
  };
  const names = () => Array.from(app.querySelectorAll("li")).map((l) => l.textContent?.trim());
  return { app, input, query, type, names };
}

test("v-if + unkeyed v-for over a child computed survives a v-model shrink", () => {
  const { app, type, names } = mountPair(
    `<div>
       <ul v-if="filteredData.length">
         <li v-for="entry in filteredData">{{ entry.name }}</li>
       </ul>
       <p v-else>No matches found.</p>
     </div>`,
  );

  expect(names()).toHaveLength(4);

  type("lee"); // 4 -> 1
  expect(names()).toEqual(["Bruce Lee"]);

  type("chan"); // 1 -> 1 (different row)
  expect(names()).toEqual(["Jackie Chan"]);

  type("z"); // 1 -> 0, v-if flips to the <p v-else>
  expect(names()).toHaveLength(0);
  expect(app.querySelector("p")?.textContent?.trim()).toBe("No matches found.");

  type(""); // 0 -> 4, back to the full list
  expect(names()).toHaveLength(4);
  expect(names()).toEqual(["Chuck Norris", "Bruce Lee", "Jackie Chan", "Jet Li"]);
});

test("keyed variant survives the same shrink/grow cycle", () => {
  const { type, names } = mountPair(
    `<div>
       <ul v-if="filteredData.length">
         <li v-for="entry in filteredData" :key="entry.name">{{ entry.name }}</li>
       </ul>
       <p v-else>No matches found.</p>
     </div>`,
  );

  expect(names()).toHaveLength(4);
  type("i"); // Chuck Norris (norrIs), Jackie Chan (jackIe), Jet Li (lI)
  expect(names()).toEqual(["Chuck Norris", "Jackie Chan", "Jet Li"]);
  type("");
  expect(names()).toHaveLength(4);
});
