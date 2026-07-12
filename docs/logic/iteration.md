# Iteration

## `v-for`

Use `v-for` to render an element for each item in an array:

```vue
<li v-for="item in items" :key="item.id">
  {{ item.name }}
</li>
```

`:key` should be a stable, unique identifier for each item, used for keyed reconciliation. It is strongly recommended; when omitted, rows reconcile positionally.

## Syntax

`v-for` uses `alias in source` syntax:

```vue
<!-- single alias -->
<div v-for="item in list" :key="item.id">{{ item.name }}</div>

<!-- with index -->
<div v-for="(item, index) in list" :key="item.id">#{{ index }}: {{ item.name }}</div>
```

| Part | Description |
|---|---|
| `item` | Variable bound to the current item |
| `index` | Optional variable bound to the current index |
| `list` | The iterable expression (must be an array) |
| `:key="item.id"` | Unique identifier expression per item |

### Destructuring the item

Flat object and array destructuring in the alias are supported:

```vue
<li v-for="{ id, name } in users" :key="id">{{ name }}</li>
<li v-for="[first, second] in pairs" :key="first">{{ first }} / {{ second }}</li>
```

Nested patterns, defaults (`{ a = 1 }`), and rest (`{ ...r }`) are **not** supported — keep it flat and fail loud.

## Full example

```vue
<script setup>
  import { signal } from "decagrammaton";

  const students = signal([
    { id: 1, name: "Aru", squad: "Problem Solver 68" },
    { id: 2, name: "Hina", squad: "Prefect Team" },
    { id: 3, name: "Iori", squad: "Problem Solver 68" },
  ]);

  function remove(id) {
    students.value = students.value.filter((s) => s.id !== id);
  }
</script>

<template>
  <div>
    <div v-for="student in students" :key="student.id">
      <span>{{ student.name }} — {{ student.squad }}</span>
      <button @click="() => remove(student.id)">Remove</button>
    </div>
  </div>
</template>
```

## How it works

At runtime, `v-for` uses **keyed reconciliation** (a port of Vue Vapor's right-to-left keyed diff, minus the VDOM):

1. The source expression is read inside a render effect.
2. Each row gets a scope exposing the alias bindings (`item`, `index`, or destructured locals).
3. The `:key` expression produces a unique key per row.
4. New keys mount fresh nodes; removed keys are unmounted; existing keys keep their DOM node identity.

So **adding** an item mounts new DOM without touching existing rows, **removing** cleans up only that row, and **reordering** preserves node identity by key.

## Combining with other directives

`v-for` works on a component tag:

```vue
<TaskItem
  v-for="task in filteredTasks"
  :key="task.id"
  :task="task"
  :onToggle="toggleTask"
/>
```

You can nest `v-if` inside a `v-for` element:

```vue
<div v-for="task in tasks" :key="task.id">
  <span v-if="task.done">Done!</span>
  <span v-else>{{ task.text }}</span>
</div>
```

## Rules

- `v-for` uses `alias in source` syntax — anything else is a parse error.
- The source must evaluate to an array.
- **`v-if` and `v-for` on the same element is rejected** — nest one inside the other (see [Conditional Rendering](/logic/conditional-rendering)).
- **Each row must have a single root element or component** — a row cannot be bare text or a fragment.
- Keys should be **stable** and **unique** — avoid the index as key when items can be reordered or removed.
