# States

## `signal`

`signal` creates a reactive state container. Decagrammaton's reactivity is a thin re-export of [@sigrea/core](https://github.com/sigrea/core), so a signal exposes a `.value` property for reading and writing.

```ts
import { signal } from "decagrammaton";

const count = signal(0);

count.value; // 0
count.value = 5;
count.value; // 5
```

### How it works

`signal(initialValue)` returns an object with a `.value` accessor:

- **Getting** `.value` reads the underlying signal — any active `watchEffect`, `computed`, or template render effect that reads it becomes a subscriber.
- **Setting** `.value` writes to the signal and notifies all subscribers, triggering re-renders and recomputation.

### Type signature

```ts
function signal<T>(initialValue: T): Signal<T>;

interface Signal<T> {
  value: T;
}
```

### Usage in templates

In `<script setup>` you always go through `.value`. In the template you **don't** — the compiler wraps each expression in a render effect and auto-unwraps signals, so you reference the binding directly:

```vue
<script setup>
  import { signal } from "decagrammaton";

  const name = signal("Sensei");
</script>

<template>
  <p>Hello, {{ name }}!</p>
</template>
```

When `name.value` changes, the text node updates automatically. (Writing `{{ name.value }}` also works — `.value` on a plain object is harmless — but the idiomatic Vue form is `{{ name }}`.)

### Updating complex state

A plain `signal` tracks reassignment of `.value`, not mutation of what's inside it. For an object or array, replace the whole value to trigger reactivity:

```ts
const tasks = signal([
  { id: 1, text: "Clear Lesson 25", done: false },
]);

// This triggers an update:
tasks.value = [...tasks.value, { id: 2, text: "Farm elephs", done: false }];

// This does NOT trigger an update:
tasks.value.push({ id: 3, text: "Oops", done: false });
```

### `deepSignal` — reactive mutation

When you *do* want to mutate nested structures in place, use `deepSignal`. It wraps the value in a deep reactive proxy, so property writes and array mutations are tracked without reassigning `.value`. Unlike `signal`, you read and write the properties directly (no `.value` on the container):

```ts
import { deepSignal } from "decagrammaton";

const tree = deepSignal({
  name: "My Tree",
  children: [{ name: "hello" }, { name: "world" }],
});

// Tracked — no reassignment needed:
tree.children.push({ name: "new stuff" });
tree.name = "Renamed";
```

This is the shape used by the tree-view example: a `deepSignal` model passed down as a prop, mutated in place by child components.

Related variants are also re-exported: `shallowDeepSignal`, `readonlyDeepSignal`, `readonlyShallowDeepSignal`, plus the helpers `isSignal`, `isDeepSignal`, `toValue`, `toRawDeepSignal`, and `markRaw`.

### Passing signals as props

Props are **one-way and read-only**. When you pass a signal through a `:prop` binding, the child receives the signal's *unwrapped value*, not the signal object — the template context unwraps signals on read, and the prop getter reads through that context:

```vue
<!-- Parent.vue -->
<script setup>
  import { signal } from "decagrammaton";
  import Greeting from "./Greeting.vue";

  const count = signal(0);
</script>

<template>
  <!-- the child sees a number, kept reactive by the getter -->
  <Greeting :count="count" />
  <button @click="count++">++</button>
</template>
```

```vue
<!-- Greeting.vue -->
<script setup>
  const props = defineProps({ count: Number });
</script>

<template>
  <p>The count is {{ count }}</p>
</template>
```

The prop stays reactive (the parent's signal is tracked through the getter), but the child **cannot** write it back — attempting `props.count = …` throws. There is no component `v-model` and no `emit` channel, so a child does not push values back up through props. See [Passing Down Props](/properties/passing-down).

### Sharing mutable state down the tree

When a descendant genuinely needs to mutate shared state, pass a `deepSignal`. A `deepSignal` is a reactive **proxy object**, so it is *not* unwrapped by the context — the child receives the same proxy and mutations are visible everywhere:

```vue
<!-- Parent.vue -->
<script setup>
  import { deepSignal } from "decagrammaton";
  import TreeItem from "./TreeItem.vue";

  const model = deepSignal({ name: "root", children: [{ name: "hello" }] });
</script>

<template>
  <TreeItem :model="model" />
</template>
```

```vue
<!-- TreeItem.vue -->
<script setup>
  const props = defineProps({ model: Object });

  function addChild() {
    props.model.children.push({ name: "new stuff" }); // tracked, shared
  }
</script>
```

For "global-ish" shared state that skips intermediate components, [`provide` / `inject`](/properties/injection) a signal instead — both sides then read the same signal object.

