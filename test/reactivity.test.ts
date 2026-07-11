import { test, expect, describe } from "bun:test";
import { mountTemplate } from "./support.ts";
import * as reactivity from "../src/reactivity.ts";
import { signal, computed, createScope, runWithScope } from "../src/reactivity.ts";
import { renderEffect } from "../src/runtime/helpers.ts";

// ── Slice 1: reactivity swap ─────────────────────────────────────────────────
//
// src/reactivity.ts is a thin re-export of @sigrea/core. The value it must hold
// is that the exact surface decagrammaton depends on is wired — a sigrea upgrade
// that drops/renames one of these is a build break we want caught here, not in a
// downstream slice. So this is a surface + behaviour smoke, not a re-test of
// sigrea internals.

describe("reactivity re-export surface (slice 1)", () => {
  test("the names decagrammaton relies on are all exported", () => {
    // Signals + scope + the two DOM-effect-adjacent primitives the runtime imports.
    for (const name of [
      "signal", "computed", "isSignal", "watch", "watchEffect",
      "Scope", "createScope", "runWithScope", "getCurrentScope", "onDispose",
    ] as const) {
      expect(typeof (reactivity as Record<string, unknown>)[name]).toBe("function");
    }
  });

  test("signal round-trips a value via .value (the template ergonomic)", () => {
    const s = signal(1);
    expect(s.value).toBe(1);
    s.value = 2;
    expect(s.value).toBe(2);
    expect(reactivity.isSignal(s)).toBe(true);
  });

  test("computed derives and tracks its dependency", () => {
    const s = signal(2);
    const doubled = computed(() => s.value * 2);
    expect(doubled.value).toBe(4);
    s.value = 5;
    expect(doubled.value).toBe(10);
  });

  test("renderEffect flushes SYNCHRONOUSLY (the recurring gotcha)", () => {
    // sigrea's watchEffect defaults to flush:"pre" (async). renderEffect pins
    // "sync" so DOM bindings land immediately — the invariant every DOM slice
    // leans on. Prove it: a write is observed by the effect with NO await.
    const s = signal(0);
    const seen: number[] = [];
    const scope = createScope();
    runWithScope(scope, () => renderEffect(() => seen.push(s.value)));
    expect(seen).toEqual([0]); // ran immediately on creation
    s.value = 1;
    expect(seen).toEqual([0, 1]); // and synchronously on write — no microtask
    scope.dispose();
  });
});

// ── Slice 2: counter end-to-end ──────────────────────────────────────────────
//
// The whole spine in one render: @click event binding, {{ interpolation }}, the
// _ctx unwrap proxy, and a per-instance Scope — driven through the REAL generated
// render string against a real ark button in a real (happy-)DOM. This is the DOM
// proof earlier iterations deferred to the browser.

describe("counter e2e (slice 2)", () => {
  test("interpolation shows the initial signal value", () => {
    const count = signal(7);
    const { app } = mountTemplate(`<button @click="inc">{{ count }}</button>`, {
      count,
      inc: () => count.value++,
    });
    expect(app.querySelector("button")!.textContent).toBe("7");
  });

  test("a click runs the handler and the text updates synchronously", () => {
    const count = signal(0);
    const { app } = mountTemplate(`<button @click="inc">{{ count }}</button>`, {
      count,
      inc: () => count.value++,
    });
    const btn = app.querySelector("button")! as HTMLElement;
    btn.click();
    expect(btn.textContent).toBe("1");
    btn.click();
    btn.click();
    expect(btn.textContent).toBe("3");
  });

  test("inline handler `count++` writes through the _ctx set trap", () => {
    // No method — the handler mutates the signal directly. createContext's set
    // trap must route `count = count + 1` to count.value, not replace the signal.
    const count = signal(10);
    const { app } = mountTemplate(`<button @click="count++">{{ count }}</button>`, { count });
    const btn = app.querySelector("button")! as HTMLElement;
    btn.click();
    expect(btn.textContent).toBe("11");
    // The signal object survived (was mutated, not overwritten with a number).
    expect(reactivity.isSignal(count)).toBe(true);
    expect(count.value).toBe(11);
  });

  test("an external signal write re-renders the mounted text", () => {
    const count = signal(0);
    const { app } = mountTemplate(`<span>{{ count }}</span>`, { count });
    const span = app.querySelector("span")!;
    expect(span.textContent).toBe("0");
    count.value = 99; // mutate from outside any handler — sync effect repaints
    expect(span.textContent).toBe("99");
  });

  test("disposing the instance scope stops further DOM updates", () => {
    const count = signal(0);
    const { app, scope } = mountTemplate(`<span>{{ count }}</span>`, { count });
    const span = app.querySelector("span")!;
    scope.dispose();
    count.value = 5; // effect is torn down — the node must NOT change
    expect(span.textContent).toBe("0");
  });
});
