# Effects

## `$effect`

`$effect` runs a function reactively — it re-executes whenever any signal or computed value accessed inside it changes.

```ts
import { $signal, $effect } from "decagrammaton";

const count = $signal(0);

const dispose = $effect(() => {
  console.log("Count is now:", count.value);
});
// logs: "Count is now: 0"

count.value = 5;
// logs: "Count is now: 5"
```

### How it works

When `$effect(fn)` is called:

1. The function `fn` runs immediately
2. Any `.value` reads inside `fn` are tracked as dependencies
3. When a dependency changes, `fn` runs again
4. Returns a **dispose function** — call it to stop the effect and clean up subscriptions

### Type signature

```ts
function $effect(fn: () => void | (() => void)): () => void;
```

The callback can optionally return a cleanup function. This cleanup runs before each re-execution and when the effect is disposed:

```ts
const dispose = $effect(() => {
  const interval = setInterval(() => console.log(count.value), 1000);
  return () => clearInterval(interval); // cleanup
});
```

### Disposing effects

Always dispose effects when they're no longer needed to avoid memory leaks:

```ts
const dispose = $effect(() => {
  console.log(count.value);
});

// later, when done:
dispose();
```

::: tip
Inside `.deca` templates, you rarely need to use `$effect` directly. The framework automatically wraps template expressions in effects for you — text nodes, attribute bindings, conditional branches, and list iterations all use effects internally.
:::

### When to use `$effect`

Use `$effect` for side effects that should react to state changes but live outside the template:

```ts
const theme = $signal("light");

$effect(() => {
  document.body.className = theme.value === "dark" ? "dark-mode" : "";
});
```

Common use cases:
- Logging or debugging reactive state
- Syncing state to `localStorage` or external APIs
- Setting up/tearing down subscriptions based on reactive values
- Triggering imperative DOM operations outside the template

### `$effect` vs `$computed`

| `$effect` | `$computed` |
|---|---|
| For **side effects** (do something) | For **derived values** (calculate something) |
| Returns a dispose function | Returns a reactive value with `.value` |
| Runs immediately, re-runs on changes | Recalculates on demand when dependencies change |
| No return value used by the framework | Return value is cached and trackable |
