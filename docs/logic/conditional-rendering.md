# Conditional Rendering

## `v-if`

Use `v-if` to conditionally render an element based on an expression:

```vue
<p v-if="loggedIn">Welcome back!</p>
```

The element and its children are only mounted when the expression is truthy. When it becomes falsy, the element is removed and its reactive scope is disposed.

## `v-else-if`

Chain additional conditions with `v-else-if`:

```vue
<p v-if="status === 'loading'">Loading...</p>
<p v-else-if="status === 'error'">Something went wrong</p>
<p v-else-if="status === 'empty'">No results found</p>
```

`v-else-if` must immediately follow a `v-if` or another `v-else-if` (whitespace and comments between them are allowed).

## `v-else`

Use `v-else` as a fallback branch:

```vue
<p v-if="count > 0">You have {{ count }} items</p>
<p v-else>No items yet</p>
```

`v-else` must be the last branch and takes no value.

## Full example

```vue
<script setup>
  import { signal, computed } from "decagrammaton";

  const tasks = signal([]);

  const status = computed(() => {
    if (tasks.value.length === 0) return "empty";
    if (tasks.value.every((t) => t.done)) return "complete";
    return "active";
  });
</script>

<template>
  <div v-if="status === 'complete'">
    <p>All done!</p>
  </div>
  <div v-else-if="status === 'active'">
    <p>{{ tasks.filter((t) => !t.done).length }} tasks remaining</p>
  </div>
  <div v-else>
    <p>No tasks yet. Add one!</p>
  </div>
</template>
```

## How it works

The compiler folds a consecutive `v-if` / `v-else-if` / `v-else` run into a single conditional group. At runtime:

1. The branch conditions are read inside a render effect.
2. Each condition is evaluated in order; the first truthy branch is mounted.
3. When the active branch changes, the old branch is unmounted (its scope disposed) and the new one is mounted at the same anchor.

## Rules

- `v-if` and `v-else-if` require an expression; `v-else` takes none.
- `v-else-if` / `v-else` must immediately follow a `v-if` or `v-else-if`.
- You can have multiple `v-else-if` branches but only one `v-else`.
- **Each branch must have a single root element or component.** A branch cannot be bare text or a fragment of multiple siblings.
- **`v-if` and `v-for` on the *same* element is rejected** (Vue gives `v-if` higher priority, so it couldn't see the loop variable — always a footgun). Wrap one in the other instead:

```vue
<!-- ✗ throws -->
<li v-for="task in tasks" v-if="task.done" :key="task.id">{{ task.text }}</li>

<!-- ok: nest instead -->
<div v-for="task in tasks" :key="task.id">
  <span v-if="task.done">{{ task.text }}</span>
</div>
```

::: info No `<template>` grouping
Vue lets you put `v-if` on a `<template>` to toggle a group without a wrapper element. Decagrammaton does **not** support `<template>` as a grouping tag — use a real single root element (e.g. a `<div>`).
:::
