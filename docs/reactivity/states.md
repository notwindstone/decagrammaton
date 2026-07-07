# States

## `$signal`

`$signal` creates a reactive state container. It wraps [alien-signals](https://github.com/nicepkg/alien-signals) under the hood, exposing a `.value` property for reading and writing.

```ts
import { $signal } from "decagrammaton";

const count = $signal(0);

count.value; // 0
count.value = 5;
count.value; // 5
```

### How it works

`$signal(initialValue)` returns an object with a single `.value` property defined via `Object.defineProperty`:

- **Getting** `.value` reads the underlying signal — any active `$effect` or `$computed` that reads it becomes a subscriber
- **Setting** `.value` writes to the signal and notifies all subscribers, triggering re-renders and recomputation

### Type signature

```ts
function $signal<T>(initialValue: T): SignalType<T>;

interface SignalType<T> {
  value: T;
}
```

### Usage in templates

In `.deca` templates, always access the state through `.value`:

```html
<script lang="ts">
  import { $signal } from "decagrammaton";

  const name = $signal("Sensei");
</script>

<template>
  <p>Hello, {name.value}!</p>
</template>
```

The framework wraps template expressions in effects internally. When `name.value` changes, the text node updates automatically.

### Updating complex state

For objects and arrays, you must replace the entire `.value` to trigger reactivity — mutations inside the object won't be tracked:

```ts
const tasks = $signal([
  { id: 1, text: "Clear Lesson 25", done: false },
]);

// This triggers an update:
tasks.value = [...tasks.value, { id: 2, text: "Farm elephs", done: false }];

// This does NOT trigger an update:
tasks.value.push({ id: 3, text: "Oops", done: false });
```

### Batching updates

When you need to set multiple signals at once without triggering intermediate re-renders, use `startBatch` and `endBatch`:

```ts
import { $signal, startBatch, endBatch } from "decagrammaton";

const a = $signal(1);
const b = $signal(2);

startBatch();
a.value = 10;
b.value = 20;
endBatch(); // subscribers notified once here
```

### Passing signals as props

Signals are plain objects, so passing them as props gives the child component a reference to the same signal. This means **two-way binding works automatically**:

```html
<!-- parent.deca -->
<script lang="ts">
  import { $signal } from "decagrammaton";
  import Child from "./child.deca";

  const filter = $signal("all");
</script>

<template>
  <Child filter={filter} />
  <p>Current filter: {filter.value}</p>
</template>
```

```html
<!-- child.deca -->
<script lang="ts">
  const { filter } = defineProps();
</script>

<template>
  <button @click={() => filter.value = 'active'}>Active</button>
</template>
```

When the child sets `filter.value`, the parent sees the change too — they share the same signal object.
