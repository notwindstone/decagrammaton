# Provide / Inject

## Overview

`provide` and `inject` are compiler macros for sharing data across the component tree without passing props through every level. This is useful for "global-ish" values like themes, user context, or app configuration.

```html
<!-- ancestor.deca -->
<script lang="ts">
  import { $signal } from "decagrammaton";

  const theme = $signal("dark");
  provide('theme', theme);
</script>
```

```html
<!-- deeply-nested-descendant.deca -->
<script lang="ts">
  const theme = inject('theme');
</script>

<template>
  <p>Theme is: {theme.value}</p>
</template>
```

## `provide`

`provide(key, value)` makes a value available to all descendant components.

```ts
provide('appName', appName);
provide('api', apiClient);
```

- **`key`** — a string identifier
- **`value`** — any value (signals, computed values, plain objects, functions, etc.)

Each component has its own provide scope. If a component provides a key that an ancestor also provided, descendants will see the closer (more deeply nested) value.

## `inject`

`inject(key)` retrieves a value provided by an ancestor component.

```ts
const appName = inject('appName');
```

It walks up the component tree (via prototype chain) and returns the value from the nearest ancestor that called `provide` with that key. Returns `undefined` if no ancestor provided it.

## Reactivity through context

To make injected values reactive, provide a signal or computed:

```html
<!-- provider.deca -->
<script lang="ts">
  import { $signal } from "decagrammaton";

  const user = $signal({ name: "Sensei", level: 78 });
  provide('currentUser', user);
</script>
```

```html
<!-- consumer.deca -->
<script lang="ts">
  const user = inject('currentUser');
</script>

<template>
  <p>Welcome, {user.value.name}! (Lv.{user.value.level})</p>
</template>
```

Since the injected value is the same signal object, `.value` access in the template is automatically tracked by the reactivity system.

## How it works internally

Context propagation uses JavaScript's prototype chain:

1. Each component instance gets a `childContext` object created with `Object.create(parentContext)`
2. `provide(key, value)` writes to `childContext`
3. `inject(key)` reads from `parentContext`
4. Prototype chain lookup naturally finds the nearest ancestor's value

This means `inject` lookups are O(depth) in the worst case, but effectively instant for typical component trees.

## When to use provide/inject vs props

| Use **props** | Use **provide/inject** |
|---|---|
| Direct parent-child communication | Data needed by deeply nested components |
| Component API should be explicit | Avoiding "prop drilling" through intermediate components |
| Few levels of nesting | Global-ish values (themes, user context, config) |

::: warning
`provide` and `inject` are **compiler macros**. They are injected automatically — don't import them. They only work at the top level of a `.deca` `<script>` block.
:::
