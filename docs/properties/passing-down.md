# Passing Down Props

## `defineProps`

`defineProps` is a Vue compiler macro that declares the props a child component receives. Pass it an object describing the prop names (the constructor values are Vue-style declarations and are not validated at runtime here):

```vue
<!-- Child.vue -->
<script setup>
  const props = defineProps({ name: String, age: Number });
</script>

<template>
  <p>{{ name }} is {{ age }} years old</p>
</template>
```

```vue
<!-- Parent.vue -->
<script setup>
  import Child from "./Child.vue";
</script>

<template>
  <Child name="Aru" :age="16" />
</template>
```

### How it works

`defineProps` is **not imported** — it's a macro handled by `@vue/compiler-sfc` at build time. The values a parent passes are exposed to the child both as the returned `props` object and as bare identifiers in the template (`{{ name }}` resolves to the prop when no same-named local shadows it).

Props can be passed as:

- **Static strings** — `name="Aru"` passes the string `"Aru"`.
- **Bindings** — `:age="16"` or `:count="count"` evaluates the expression and passes the result. A binding that reads a signal stays reactive: the parent's signal is tracked through a getter, so the child re-renders when it changes.

### Props are read-only and one-way

The child receives prop **values**, and the props object is read-only — assigning to a prop throws:

```js
props.name = "Hina"; // Error: props are read-only (they belong to the parent)
```

There is no component `v-model` and no `defineEmits` / `emit` channel — both throw at build time. A child does not send values back to its parent through the component boundary. To share writable state, see below.

### Passing different types

#### Reactive values (signals / computed)

Passing a `signal` or `computed` through a binding keeps the displayed value reactive, but the child sees the **unwrapped value** — the template context unwraps signals on read. The child can display it, not reassign the parent's signal:

```vue
<Greeting name="world" :count="count" />
```

```vue
<!-- Greeting.vue -->
<script setup>
  const props = defineProps({ name: String, count: Number });
</script>

<template>
  <p>Hello {{ name }}, the count is {{ count }}.</p>
</template>
```

#### Shared mutable objects (`deepSignal`)

A `deepSignal` is a reactive proxy object, not a `.value` wrapper, so it is **not** unwrapped — the child gets the same proxy and can mutate it in place, with changes visible to every holder:

```vue
<TreeItem :model="model" />
```

```vue
<!-- TreeItem.vue -->
<script setup>
  const props = defineProps({ model: Object });

  function addChild() {
    props.model.children.push({ name: "new stuff" }); // shared + tracked
  }
</script>
```

This is the intended pattern for downward-flowing mutable state (used by the tree-view example).

#### Callbacks

Because there is no `emit`, the way a child signals its parent is a **callback prop** — pass a function down and the child calls it:

```vue
<TaskInput :onAdd="addTask" />
```

```vue
<!-- TaskInput.vue -->
<script setup>
  const props = defineProps({ onAdd: Function });
</script>

<template>
  <button @click="onAdd">Add</button>
</template>
```

#### Plain data

Non-reactive objects and primitives pass by value.

### kebab-case props

Prop names written in kebab-case on the tag are normalized to camelCase for the child, matching Vue — `<Child my-prop="x" />` is read as `myProp`. (A bare `_ctx["my-prop"]` is not valid JS, so the compiler camelises the key.)

::: warning
`defineProps` is a **compiler macro**. It only works at the top level of a `<script setup>` block — don't import it or call it conditionally.
:::
