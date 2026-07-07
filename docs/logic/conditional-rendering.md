# Conditional Rendering

## `:if`

Use the `:if` directive to conditionally render an element based on an expression:

```html
<p :if={loggedIn.value}>Welcome back!</p>
```

The element and its children are only mounted when the expression is truthy. When the expression becomes falsy, the element is removed from the DOM and cleaned up.

## `:else-if`

Chain additional conditions with `:else-if`:

```html
<p :if={status.value === 'loading'}>Loading...</p>
<p :else-if={status.value === 'error'}>Something went wrong</p>
<p :else-if={status.value === 'empty'}>No results found</p>
```

`:else-if` must immediately follow a `:if` or another `:else-if` element (whitespace between them is allowed).

## `:else`

Use `:else` as a fallback branch:

```html
<p :if={count.value > 0}>You have {count.value} items</p>
<p :else>No items yet</p>
```

`:else` must be the last branch and takes no value.

## Full example

```html
<script lang="ts">
  import { $signal, $computed } from "decagrammaton";

  const tasks = $signal([]);

  const status = $computed(() => {
    if (tasks.value.length === 0) return "empty";
    if (tasks.value.every(t => t.done)) return "complete";
    return "active";
  });
</script>

<template>
  <div :if={status.value === 'complete'}>
    <p>All done!</p>
  </div>
  <div :else-if={status.value === 'active'}>
    <p>{tasks.value.filter(t => !t.done).length} tasks remaining</p>
  </div>
  <div :else>
    <p>No tasks yet. Add one!</p>
  </div>
</template>
```

## How it works

The compiler groups consecutive `:if` / `:else-if` / `:else` elements into a single `ConditionalNode` in the AST. At runtime:

1. The branches are wrapped in an `effect()`
2. Each branch condition is evaluated in order
3. The first truthy branch is mounted into a wrapper `<div>`
4. When the active branch changes, the old branch is unmounted and the new one takes its place

::: info
Each conditional branch is wrapped in an extra `<div>` at runtime. This is an implementation detail for efficient DOM swapping and shouldn't affect your layout when using atomic CSS.
:::

## Rules

- `:if` must have an expression value: `:if={expression}`
- `:else-if` must have an expression value: `:else-if={expression}`
- `:else` takes no value — just `:else` on the element
- `:else-if` and `:else` must immediately follow a `:if` or `:else-if` element
- You can have multiple `:else-if` branches but only one `:else`
