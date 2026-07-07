# Computed States

## `$computed`

`$computed` creates a **read-only** derived state that automatically recalculates when its dependencies change.

```ts
import { $signal, $computed } from "decagrammaton";

const count = $signal(3);
const doubled = $computed(() => count.value * 2);

doubled.value; // 6
count.value = 5;
doubled.value; // 10
```

### How it works

`$computed(getter)` returns an object with a read-only `.value` property. The getter function is tracked — any `$signal` or `$computed` accessed inside it becomes a dependency. When a dependency changes, the computed value is eagerly recalculated.

Attempting to set `.value` on a computed throws an error:

```ts
const doubled = $computed(() => count.value * 2);
doubled.value = 99; // Error: Cannot set the value of a computed property
```

### Type signature

```ts
function $computed<T>(getter: () => T): ComputedType<T>;

interface ComputedType<T> {
  readonly value: T;
}
```

### Chaining

Computed values can depend on other computed values:

```ts
const count = $signal(2);
const doubled = $computed(() => count.value * 2);
const quadrupled = $computed(() => doubled.value * 2);

quadrupled.value; // 8
count.value = 3;
quadrupled.value; // 12
```

### Template usage

Use `.value` in templates just like signals:

```html
<script lang="ts">
  import { $signal, $computed } from "decagrammaton";

  const tasks = $signal([
    { id: 1, text: "Study", done: true },
    { id: 2, text: "Train", done: false },
  ]);

  const stats = $computed(() => {
    const all = tasks.value;
    const done = all.filter(t => t.done).length;
    return { total: all.length, done, remaining: all.length - done };
  });
</script>

<template>
  <p>{stats.value.done} / {stats.value.total} tasks completed</p>
</template>
```

### When to use `$computed` vs `$signal`

| Use `$signal` | Use `$computed` |
|---|---|
| Value is set directly by user action or code | Value is derived from other reactive state |
| Needs to be writable | Should be read-only |
| Source of truth | Cached transformation |
