import { test, expect, describe } from "bun:test";
import { mountTemplate } from "./support.ts";
import { signal } from "../src/reactivity.ts";

// ── Slice 4: keyed v-for reconciler ──────────────────────────────────────────
//
// createFor is a port of vapor's keyed diff (right-to-left placement, no LIS, no
// linked list). Its load-bearing promise is IDENTITY PRESERVATION: a reorder /
// insert / remove keyed by `:key` must MOVE existing DOM nodes, not recreate
// them. Earlier iterations proved this only in the browser; here it round-trips
// through real ark <li> nodes in happy-dom, so `moves the same node object` is a
// genuine assertion, not a signal-layer approximation.
//
// Helper: the live <li> elements under #app, and a per-node stamp so we can prove
// a specific DOM node survived a mutation (identity), independent of its text.

function lis(app: HTMLElement): HTMLElement[] {
  return Array.from(app.querySelectorAll("li"));
}
function texts(app: HTMLElement): string[] {
  return lis(app).map((li) => li.textContent ?? "");
}
// Stamp every current <li> with an ordinal, keyed by its visible name, so after a
// mutation we can ask "is the node showing X the SAME object it was before?".
function stamp(app: HTMLElement): Map<string, HTMLElement> {
  const m = new Map<string, HTMLElement>();
  for (const li of lis(app)) m.set(li.textContent ?? "", li);
  return m;
}

const KEYED = `<ul><li v-for="(row, i) in rows" :key="row.id">{{ i }}:{{ row.name }}</li></ul>`;

describe("keyed v-for (slice 4)", () => {
  test("initial mount renders every row in source order", () => {
    const rows = signal([
      { id: 1, name: "apple" },
      { id: 2, name: "banana" },
      { id: 3, name: "cherry" },
    ]);
    const { app } = mountTemplate(KEYED, { rows });
    expect(texts(app)).toEqual(["0:apple", "1:banana", "2:cherry"]);
  });

  test("reverse MOVES the existing nodes (identity preserved), not recreates", () => {
    const rows = signal([
      { id: 1, name: "apple" },
      { id: 2, name: "banana" },
      { id: 3, name: "cherry" },
    ]);
    const { app } = mountTemplate(KEYED, { rows });

    const appleNode = stamp(app).get("0:apple")!;
    const cherryNode = stamp(app).get("2:cherry")!;

    rows.value = [...rows.value].reverse();

    // Order flipped, and the index interpolation re-ran for the reused rows.
    expect(texts(app)).toEqual(["0:cherry", "1:banana", "2:apple"]);
    // The SAME DOM objects were relocated: apple is now last, cherry first.
    const after = lis(app);
    expect(after[0]).toBe(cherryNode); // cherry's node moved to the front
    expect(after[2]).toBe(appleNode);  // apple's node moved to the back
  });

  test("append keeps existing nodes and adds one at the tail", () => {
    const rows = signal([{ id: 1, name: "a" }, { id: 2, name: "b" }]);
    const { app } = mountTemplate(KEYED, { rows });
    const aNode = stamp(app).get("0:a")!;

    rows.value = [...rows.value, { id: 3, name: "c" }];

    expect(texts(app)).toEqual(["0:a", "1:b", "2:c"]);
    expect(lis(app)[0]).toBe(aNode); // untouched prefix reused in place
  });

  test("remove-first drops the head node and reindexes the survivors", () => {
    const rows = signal([
      { id: 1, name: "a" }, { id: 2, name: "b" }, { id: 3, name: "c" },
    ]);
    const { app } = mountTemplate(KEYED, { rows });
    const bNode = stamp(app).get("1:b")!;

    rows.value = rows.value.slice(1);

    expect(texts(app)).toEqual(["0:b", "1:c"]);
    // b survived as the same node, its index interpolation updated 1 -> 0.
    expect(lis(app)[0]).toBe(bNode);
  });

  test("a middle insert relocates the tail and mounts only the new row", () => {
    const rows = signal([{ id: 1, name: "a" }, { id: 3, name: "c" }]);
    const { app } = mountTemplate(KEYED, { rows });
    const aNode = stamp(app).get("0:a")!;
    const cNode = stamp(app).get("1:c")!;

    rows.value = [{ id: 1, name: "a" }, { id: 2, name: "b" }, { id: 3, name: "c" }];

    expect(texts(app)).toEqual(["0:a", "1:b", "2:c"]);
    expect(lis(app)[0]).toBe(aNode); // a untouched
    expect(lis(app)[2]).toBe(cNode); // c moved down, same node
  });

  test("clear-all unmounts every row", () => {
    const rows = signal([{ id: 1, name: "a" }, { id: 2, name: "b" }]);
    const { app } = mountTemplate(KEYED, { rows });
    rows.value = [];
    expect(lis(app)).toHaveLength(0);
  });

  test("duplicate keys fail loud", () => {
    const rows = signal([{ id: 1, name: "a" }, { id: 1, name: "b" }]);
    // The dup-key guard runs inside createFor's reactive effect on mount.
    expect(() => mountTemplate(KEYED, { rows })).toThrow(/duplicate key: 1/);
  });

  test("a full key swap replaces both rows (no false reuse)", () => {
    const rows = signal([{ id: 1, name: "a" }, { id: 2, name: "b" }]);
    const { app } = mountTemplate(KEYED, { rows });
    const oldNodes = new Set(lis(app));

    rows.value = [{ id: 9, name: "x" }, { id: 8, name: "y" }];

    expect(texts(app)).toEqual(["0:x", "1:y"]);
    // Different keys → brand-new nodes; none of the originals survive.
    for (const li of lis(app)) expect(oldNodes.has(li)).toBe(false);
  });
});

describe("unkeyed v-for — positional patch (slice 4)", () => {
  const UNKEYED = `<ul><li v-for="x in xs">{{ x }}</li></ul>`;

  test("grow reuses the common prefix in place and appends the tail", () => {
    const xs = signal(["a", "b"]);
    const { app } = mountTemplate(UNKEYED, { xs });
    const firstNode = lis(app)[0];

    xs.value = ["a", "b", "c"];

    expect(texts(app)).toEqual(["a", "b", "c"]);
    expect(lis(app)[0]).toBe(firstNode); // position 0 reused, not rebuilt
  });

  test("shrink unmounts the excess tail, keeps the prefix nodes", () => {
    const xs = signal(["a", "b", "c"]);
    const { app } = mountTemplate(UNKEYED, { xs });
    const firstNode = lis(app)[0];

    xs.value = ["a"];

    expect(texts(app)).toEqual(["a"]);
    expect(lis(app)[0]).toBe(firstNode);
  });

  test("same-length change patches values into the SAME positional nodes", () => {
    // Unkeyed = positional: no identity by content, so a value swap updates the
    // existing node's text rather than moving anything.
    const xs = signal(["a", "b"]);
    const { app } = mountTemplate(UNKEYED, { xs });
    const nodes = lis(app);

    xs.value = ["b", "a"]; // same length, swapped values

    expect(texts(app)).toEqual(["b", "a"]);
    expect(lis(app)[0]).toBe(nodes[0]); // node at 0 kept, its text became "b"
    expect(lis(app)[1]).toBe(nodes[1]);
  });
});
