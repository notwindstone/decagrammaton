# Effects

## `watchEffect`

`watchEffect` runs a function reactively — it executes immediately, then re-runs whenever any signal or computed accessed inside it changes.

```ts
import { signal, watchEffect } from "decagrammaton";

const count = signal(0);

const stop = watchEffect(() => {
  console.log("Count is now:", count.value);
});
// logs: "Count is now: 0"

count.value = 5;
// logs: "Count is now: 5"
```

### How it works

When `watchEffect(fn)` is called:

1. `fn` runs immediately.
2. Any `.value` reads inside `fn` are tracked as dependencies.
3. When a dependency changes, `fn` runs again.
4. It returns a **stop handle** — call it to dispose the effect and clean up subscriptions.

The callback can register cleanup that runs before each re-run and on stop. (`watchEffect` follows [@sigrea/core](https://github.com/sigrea/core)'s API, which mirrors Vue's `watchEffect`.)

### Stopping effects

Stop an effect when it's no longer needed to avoid leaks:

```ts
const stop = watchEffect(() => {
  console.log(count.value);
});

// later, when done:
stop();
```

::: tip
Inside a `.vue` template, you rarely need `watchEffect` directly. The compiler already wraps every template expression, attribute binding, conditional branch, and list iteration in a render effect for you. Reach for `watchEffect` for side effects that live *outside* the template.
:::

## `watch`

`watch` observes a specific source (or sources) and runs a callback with the new and old values only when it changes — it does not run the body eagerly for tracking the way `watchEffect` does:

```ts
import { signal, watch } from "decagrammaton";

const query = signal("");

watch(query, (next, prev) => {
  console.log(`query changed: ${prev} -> ${next}`);
});
```

Use `watch` when you need the previous value or want to react to one explicit source; use `watchEffect` when you just want "re-run whenever anything I read changes."

## Lifecycle & scope helpers

Decagrammaton provides Vue-named lifecycle hooks and re-exports the sigrea scope helpers. Each component instance owns a scope, so effects registered during setup are disposed automatically when the component unmounts:

- `onMounted(fn)` / `onUnmounted(fn)` — run after the component's nodes are in the DOM / when it tears down. `onMounted` fires child-before-parent (Vue order). These are decagrammaton's own hooks, not sigrea's `onMount`/`onUnmount` (which require a molecule and are not exported).
- `onDispose(fn)` (aliased `onScopeDispose`) — register teardown on the current reactive scope.
- `nextTick()` — await the next reactivity flush.
- `getCurrentScope`, `createScope`, `runWithScope`, `disposeScope`, `Scope` — lower-level scope control.
- `untracked(fn)`, `pauseTracking()`, `resumeTracking()` — read reactive state without subscribing.

## When to use `watchEffect`

Use it for side effects that should react to state changes but live outside the template:

```ts
const theme = signal("light");

watchEffect(() => {
  syncThemeToHost(theme.value === "dark" ? "dark" : "light");
});
```

Common use cases:

- Logging or debugging reactive state.
- Syncing state to an external host API.
- Setting up / tearing down subscriptions based on reactive values.

## `watchEffect` vs `computed`

| `watchEffect` | `computed` |
|---|---|
| For **side effects** (do something) | For **derived values** (calculate something) |
| Returns a stop handle | Returns a reactive value with `.value` |
| Runs immediately, re-runs on changes | Recalculates on demand when dependencies change |
| No return value used by the framework | Return value is cached and trackable |
