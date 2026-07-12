# Computed States

## `computed`

`computed` creates a **read-only** derived state that automatically recalculates when its dependencies change.

```ts
import { signal, computed } from "decagrammaton";

const count = signal(3);
const doubled = computed(() => count.value * 2);

doubled.value; // 6
count.value = 5;
doubled.value; // 10
```

### How it works

`computed(getter)` returns a signal-like object with a read-only `.value`. The getter is tracked — any `signal` or `computed` accessed inside it becomes a dependency. When a dependency changes, the value is recomputed and its own subscribers are notified.

A computed is read-only; assigning `.value` is not a supported operation.

### Type signature

```ts
function computed<T>(getter: () => T): Computed<T>;

interface Computed<T> {
  readonly value: T;
}
```

`isComputed(x)` reports whether a value is a computed.

### Chaining

Computed values can depend on other computed values:

```ts
const count = signal(2);
const doubled = computed(() => count.value * 2);
const quadrupled = computed(() => doubled.value * 2);

quadrupled.value; // 8
count.value = 3;
quadrupled.value; // 12
```

### Template usage

Like signals, computed values auto-unwrap in templates — reference them without `.value`:

```vue
<script setup>
  import { signal, computed } from "decagrammaton";

  const tasks = signal([
    { id: 1, text: "Study", done: true },
    { id: 2, text: "Train", done: false },
  ]);

  const stats = computed(() => {
    const all = tasks.value;
    const done = all.filter((t) => t.done).length;
    return { total: all.length, done, remaining: all.length - done };
  });
</script>

<template>
  <p>{{ stats.done }} / {{ stats.total }} tasks completed</p>
</template>
```

### When to use `computed` vs `signal`

| Use `signal` | Use `computed` |
|---|---|
| Value is set directly by user action or code | Value is derived from other reactive state |
| Needs to be writable | Should be read-only |
| Source of truth | Cached transformation |
