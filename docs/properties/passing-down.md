# Passing Down Props

## `defineProps`

`defineProps()` is a compiler macro that lets a child component receive data from its parent.

```html
<!-- child.deca -->
<script lang="ts">
  const { name, age } = defineProps();
</script>

<template>
  <p>{name} is {age} years old</p>
</template>
```

```html
<!-- parent.deca -->
<script lang="ts">
  import Child from "./child.deca";
</script>

<template>
  <Child name="Aru" age="16" />
</template>
```

### How it works

`defineProps` is **not imported** — it's injected by the compiler at build time. Calling `defineProps()` returns an object containing all the attributes passed to the component tag in the parent template.

Props can be passed as:
- **Static strings** — `name="Aru"` passes the string `"Aru"`
- **Expressions** — `count={mySignal}` evaluates the expression and passes the result

### Destructuring

The idiomatic way to use `defineProps` is to destructure the return value:

```html
<script lang="ts">
  const { title, onSubmit, items } = defineProps();
</script>
```

You can also keep the full object:

```html
<script lang="ts">
  const props = defineProps();
  // props.title, props.onSubmit, etc.
</script>
```

### Passing different types

#### Signals (reactive two-way binding)

When you pass a signal as a prop, the child receives a **reference** to the same signal object. Changes propagate both ways:

```html
<!-- parent.deca -->
<script lang="ts">
  import { $signal } from "decagrammaton";
  import FilterBar from "./filter-bar.deca";

  const filter = $signal("all");
</script>

<template>
  <FilterBar filter={filter} />
  <p>Active filter: {filter.value}</p>
</template>
```

```html
<!-- filter-bar.deca -->
<script lang="ts">
  const { filter } = defineProps();
</script>

<template>
  <button @click={() => filter.value = 'all'}>All</button>
  <button @click={() => filter.value = 'active'}>Active</button>
</template>
```

#### Computed values (reactive read-only)

Pass a `$computed` value for derived data that the child should display but not modify:

```html
<ProgressFooter stats={stats} />
```

```html
<!-- progress-footer.deca -->
<script lang="ts">
  const { stats } = defineProps();
</script>

<template>
  <p>{stats.value.done} / {stats.value.total} completed</p>
</template>
```

#### Callbacks

Pass functions to let the child communicate events back to the parent:

```html
<TaskInput onAdd={addTask} onInput={handleInput} />
```

```html
<!-- task-input.deca -->
<script lang="ts">
  const { onAdd, onInput } = defineProps();
</script>

<template>
  <input @input={onInput} />
  <button @click={onAdd}>Add</button>
</template>
```

#### Plain data

Non-reactive objects and primitives pass by value:

```html
<TaskItem task={task} />
```

::: warning
`defineProps` is a **compiler macro**. It only works at the top level of a `.deca` `<script>` block. Don't try to import it or call it conditionally.
:::
