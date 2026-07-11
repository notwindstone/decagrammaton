import { test, expect, describe } from "bun:test";
import { signal, createScope, runWithScope } from "../src/reactivity.ts";
import {
  provide,
  inject,
  createInstance,
  runWithInstance,
  getCurrentInstance,
  type ComponentInstance,
} from "../src/runtime/instance.ts";
import { createIf, createFor } from "../src/runtime/helpers.ts";

// Mirror a synchronous mount bracket: create an instance parented to `parent`,
// run `body` (the setup analog) with it current, restore. Both real mount sites
// (createApp.mount, createComponent) do exactly this via runWithInstance.
function mount<T>(parent: ComponentInstance | null, body: () => T): [ComponentInstance, T] {
  const instance = createInstance(parent);
  return [instance, runWithInstance(instance, body)];
}

describe("provide / inject (slice 6.5)", () => {
  test("basic: parent provides, child injects", () => {
    const [parent] = mount(null, () => provide("msg", "hi"));
    mount(parent, () => expect(inject("msg")).toBe("hi"));
  });

  test("chain skip: grandchild resolves through the prototype chain", () => {
    const [gp] = mount(null, () => provide("g", "from-gp"));
    const [p] = mount(gp, () => {}); // provides nothing
    mount(p, () => expect(inject("g")).toBe("from-gp"));
  });

  test("override: nearest ancestor wins, parent unmutated (copy-on-write)", () => {
    const [parent] = mount(null, () => provide("k", "A"));
    const [child] = mount(parent, () => provide("k", "B"));
    mount(child, () => expect(inject("k")).toBe("B"));
    expect(parent.provides["k"]).toBe("A");
    expect(child.provides["k"]).toBe("B");
    expect(child.provides).not.toBe(parent.provides); // a copy was made
  });

  test("copy-on-write: an inject-only child never allocates a new provides", () => {
    const [parent] = mount(null, () => provide("k", "A"));
    const [child] = mount(parent, () => {
      inject("k");
    });
    expect(child.provides).toBe(parent.provides); // shared, no allocation
  });

  test("default: fallback returned only on a real miss", () => {
    mount(null, () => {
      expect(inject("absent", "fallback")).toBe("fallback");
      expect(inject("absent")).toBeUndefined();
      expect(inject("x2", undefined)).toBeUndefined(); // arguments.length path
    });
  });

  test("symbol key does not collide with a same-description string", () => {
    const K = Symbol("K");
    const [parent] = mount(null, () => {
      provide(K, "sym-value");
      provide("K", "str-value");
    });
    mount(parent, () => {
      expect(inject(K)).toBe("sym-value");
      expect(inject("K")).toBe("str-value");
    });
  });

  test("reactive share: same signal identity, mutation visible", () => {
    const sig = signal(0);
    const [parent] = mount(null, () => provide("count", sig));
    mount(parent, () => {
      const injected = inject("count") as typeof sig;
      expect(injected).toBe(sig); // untouched pass-through
      expect(injected.value).toBe(0);
      sig.value = 42;
      expect(injected.value).toBe(42);
    });
  });

  test("fail loud: provide/inject outside a setup bracket throw", () => {
    // currentInstance is null out here (every mount() above restored it).
    expect(getCurrentInstance()).toBeNull();
    expect(() => inject("x")).toThrow("inject() can only be called synchronously inside setup()");
    expect(() => provide("x", 1)).toThrow("provide() can only be called synchronously inside setup()");
  });
});

// ── Regression: directive re-mount instance capture ──────────────────────────
//
// The bug (found after slice 6.5 shipped): a component (re)mounted by a v-if
// branch or a v-for row LATER — reactively, outside the original mount bracket —
// saw currentInstance === null, so createComponent parented onto nothing and
// inject() missed. createIf/createFor now capture the owning instance at creation
// (like they capture getCurrentScope) and re-establish it around every factory
// run via runWithInstance. These tests drive the REAL createIf/createFor with
// minimal fake nodes and assert the factory sees the owner on a REACTIVE re-run
// (the initial run would pass even without the fix, so it is not the real proof).
//
// This is a mechanism-layer test — the real DOM re-mount is browser-verified.

// Minimal fakes: createIf/createFor only call parent.insertBefore(node, anchor)
// and node.remove(). Nothing here inspects the fakes.
const fakeNode = () => ({ remove() {} }) as any;
const fakeParent = { insertBefore() {} } as any;
const fakeAnchor = fakeNode();

// TS narrows a `let` to its initializer and can't see a write that happens inside
// a factory closure, so it thinks `captured` is still `null` at the assertion.
// `Inst` re-widens it back to the real declared type for the toBe() call.
type Inst = ComponentInstance | null;

describe("directive re-mount instance capture (regression)", () => {
  test("createIf: a branch factory re-run outside the mount bracket sees the owner", () => {
    const owner = createInstance(null);
    const cond = signal(false);
    let called = false;
    let captured: ComponentInstance | null = null;

    runWithScope(createScope(), () => {
      runWithInstance(owner, () => {
        createIf(fakeParent, fakeAnchor, [
          {
            condition: () => cond.value,
            factory: () => {
              called = true;
              captured = getCurrentInstance();
              return [fakeNode()];
            },
          },
          { condition: null, factory: () => [fakeNode()] }, // v-else
        ]);
      });
    });

    // Initial run picked the v-else branch; the tracked factory hasn't run yet.
    expect(called).toBe(false);

    // Flip the condition from OUTSIDE any bracket — mimics a click handler /
    // reactive update. renderEffect re-runs sync and mounts branch 0's factory.
    expect(getCurrentInstance()).toBeNull(); // we are genuinely outside now
    cond.value = true;

    // Before the fix this was null (factory ran with currentInstance null).
    expect(called).toBe(true);
    expect(captured as Inst).toBe(owner);
  });

  test("createFor: a row factory run outside the mount bracket sees the owner", () => {
    const owner = createInstance(null);
    const items = signal<number[]>([]);
    let called = false;
    let captured: ComponentInstance | null = null;

    runWithScope(createScope(), () => {
      runWithInstance(owner, () => {
        createFor(fakeParent, fakeAnchor, {
          ctx: {} as any,
          source: () => items.value,
          aliases: { value: "x", key: null, index: null },
          factory: () => {
            called = true;
            captured = getCurrentInstance();
            return [fakeNode()];
          },
          key: null,
        });
      });
    });

    // Empty source: no rows built yet, factory not called.
    expect(called).toBe(false);

    // Grow the list from OUTSIDE the bracket — reactive re-run builds a row.
    expect(getCurrentInstance()).toBeNull();
    items.value = [1];

    expect(called).toBe(true);
    expect(captured as Inst).toBe(owner);
  });
});
