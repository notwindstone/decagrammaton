# Provide / Inject

## Overview

`provide` and `inject` share data across the component tree without passing props through every level — useful for "global-ish" values like themes, user context, or app configuration. Unlike Vue's macros, here they are **real functions imported from `decagrammaton`**:

```vue
<!-- Ancestor.vue -->
<script setup>
  import { signal, provide } from "decagrammaton";

  const theme = signal("dark");
  provide("theme", theme);
</script>
```

```vue
<!-- DeeplyNestedDescendant.vue -->
<script setup>
  import { inject } from "decagrammaton";

  const theme = inject("theme");
</script>

<template>
  <p>Theme is: {{ theme }}</p>
</template>
```

## `provide`

`provide(key, value)` makes a value available to all descendant components.

```ts
import { provide } from "decagrammaton";

provide("appName", appName);
provide("api", apiClient);
```

- **`key`** — a string **or symbol** identifier. Symbols let two sandboxed plugins avoid colliding on a shared string key.
- **`value`** — any value (signals, computed, deep signals, plain objects, functions, etc.).

Each component has its own provide scope layered on its parent's. A descendant sees the closest (most deeply nested) provided value for a key.

::: warning
`provide` (and `inject`) may **only** be called synchronously inside `setup` — i.e. at the top level of `<script setup>`. Calling either later (e.g. from an event handler) throws:
`provide() can only be called synchronously inside setup().`

There is also **no root-level `app.provide()`** — provide/inject works at the component-instance level only.
:::

## `inject`

`inject(key)` retrieves a value provided by an ancestor. It walks up the instance chain and returns the nearest ancestor's value for that key:

```ts
import { inject } from "decagrammaton";

const appName = inject("appName");
```

If no ancestor provided the key, `inject` returns `undefined`, or a default when you pass one:

```ts
const theme = inject("theme", "light"); // "light" if nobody provided "theme"
```

Like `provide`, `inject` is setup-only and throws if called outside a mount bracket.

## Reactivity through context

`inject` returns the value **untouched** — it does not unwrap or copy. To share reactive state, provide a signal (or deep signal) and let both sides read the same object:

```vue
<!-- Provider.vue -->
<script setup>
  import { signal, provide } from "decagrammaton";

  const user = signal({ name: "Sensei", level: 78 });
  provide("currentUser", user);
</script>
```

```vue
<!-- Consumer.vue -->
<script setup>
  import { inject } from "decagrammaton";

  const user = inject("currentUser");
</script>

<template>
  <p>Welcome, {{ user.name }}! (Lv.{{ user.level }})</p>
</template>
```

Because the injected value is the same signal object, reads in the template are tracked by the reactivity system.

## How it works internally

Context propagation uses a prototype-chained `provides` object per instance:

1. Each instance starts with a `provides` that **shares** its parent's reference (copy-on-first-write — a component that only injects never allocates).
2. The first `provide(key, value)` replaces it with `Object.create(parentProvides)` and writes the key.
3. `inject(key)` resolves via `key in provides` — a prototype-chain walk that naturally finds the nearest ancestor's value.

The null-prototype base keeps `Object.prototype` keys (`toString`, `constructor`, …) from leaking into lookups.

## When to use provide/inject vs props

| Use **props** | Use **provide/inject** |
|---|---|
| Direct parent-child communication | Data needed by deeply nested components |
| Component API should be explicit | Avoiding "prop drilling" through intermediate components |
| Few levels of nesting | Global-ish values (themes, user context, config) |
