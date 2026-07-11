import { test, expect, describe } from "bun:test";
import { signal, createScope, runWithScope } from "../src/reactivity.ts";
import { createProps, createContext, renderEffect } from "../src/runtime/helpers.ts";

// ── Slice 6: props ───────────────────────────────────────────────────────────
//
// Two proxies carry props. createProps wraps the parent's per-prop GETTERS (codegen
// emits `{ count: () => _ctx.x }`) into the object the child reads: a read invokes
// the getter, so reading inside a child effect tracks the PARENT signal the getter
// closes over — that is the whole reactivity story, no extra machinery. createContext
// layers props UNDER setup state so `{{ label }}` falls through to a prop the setup
// return doesn't own. Both traps are hardened (own-keys only, read-only props); these
// tests pin that hardening, plus the reactive flow end-to-end via a real effect.

describe("createProps — the child-side prop proxy (slice 6)", () => {
  test("reading a prop invokes its getter", () => {
    const props = createProps({ count: () => 42, msg: () => "hi" });
    expect(props.count).toBe(42);
    expect(props.msg).toBe("hi");
  });

  test("an absent prop is undefined (Vue's semantics), not a thrown/inherited value", () => {
    const props = createProps({ count: () => 1 });
    expect(props.missing).toBeUndefined();
  });

  test("Object.prototype keys do NOT leak as callable getters", () => {
    // The own-key guard: Reflect.get would find Object.prototype.valueOf (a fn)
    // and the getter branch would CALL it, returning junk or throwing. Must be
    // treated as an absent prop instead.
    const props = createProps({ count: () => 1 });
    expect(props.valueOf).toBeUndefined();
    expect(props.toString).toBeUndefined();
    expect(props.constructor).toBeUndefined();
  });

  test("props are READ-ONLY — assigning throws loud (parent owns them)", () => {
    const props = createProps({ count: () => 1 });
    expect(() => {
      (props as { count: unknown }).count = 2;
    }).toThrow(/read-only/);
  });

  test("a getter read inside an effect TRACKS the parent signal (reactive flow)", () => {
    // The core slice-6 promise: a dynamic prop stays reactive with zero extra
    // wiring, because the getter closes over the parent's signal.
    const parent = signal(1);
    const props = createProps({ count: () => parent.value });
    const seen: unknown[] = [];
    const scope = createScope();
    runWithScope(scope, () => renderEffect(() => seen.push(props.count)));
    expect(seen).toEqual([1]);
    parent.value = 5; // mutate the PARENT — the child effect re-runs synchronously
    expect(seen).toEqual([1, 5]);
    scope.dispose();
  });
});

describe("createContext — setup state over props fall-through (slice 6)", () => {
  test("a signal in setup state unwraps on read (the {{ count }} ergonomic)", () => {
    const ctx = createContext({ count: signal(3) });
    expect(ctx.count).toBe(3);
  });

  test("a plain value / function passes through untouched", () => {
    const fn = () => 1;
    const ctx = createContext({ msg: "hi", fn });
    expect(ctx.msg).toBe("hi");
    expect(ctx.fn).toBe(fn);
  });

  test("writing a signal key routes to .value (inline `count++` support)", () => {
    const count = signal(0);
    const ctx = createContext({ count });
    (ctx as { count: number }).count = 9;
    expect(count.value).toBe(9); // the signal was mutated, not replaced
  });

  test("a template id the setup return does not own falls through to props", () => {
    // compileScript returns the props BAG but not the individual names, so
    // `{{ label }}` -> `_ctx.label` reads undefined without this second layer.
    const props = createProps({ label: () => "from-prop" });
    const ctx = createContext({ /* no label in setup */ }, props);
    expect(ctx.label).toBe("from-prop");
  });

  test("setup state WINS on collision (a local shadows a same-named prop)", () => {
    const props = createProps({ label: () => "prop" });
    const ctx = createContext({ label: signal("setup") }, props);
    expect(ctx.label).toBe("setup"); // own key wins, matching Vue
  });

  test("an explicitly-undefined own key does NOT leak through to props", () => {
    // The hasOwnProperty guard: `label: undefined` is a real own key, so it must
    // return undefined rather than falling through to the prop.
    const props = createProps({ label: () => "prop" });
    const ctx = createContext({ label: undefined }, props);
    expect(ctx.label).toBeUndefined();
  });

  test("with no props bag, a miss is undefined (root createApp path unchanged)", () => {
    const ctx = createContext({ count: signal(1) });
    expect(ctx.anything).toBeUndefined();
  });
});
