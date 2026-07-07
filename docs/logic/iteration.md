# Iteration

## `:for` and `:key`

Use the `:for` directive to render an element for each item in an array:

```html
<li :for={item in items.value} :key={item.id}>
  {item.name}
</li>
```

**`:key` is required.** It must be a unique identifier for each item, used for efficient DOM reconciliation.

## Syntax

The `:for` directive uses `binding in iterable` syntax:

```html
<!-- single binding -->
<div :for={item in list.value} :key={item.id}>
  {item.name}
</div>

<!-- with index -->
<div :for={(item, index) in list.value} :key={item.id}>
  #{index}: {item.name}
</div>
```

| Part | Description |
|---|---|
| `item` | Variable name bound to the current item |
| `index` | Optional variable name bound to the current index |
| `list.value` | The iterable expression (must be an array) |
| `:key={item.id}` | Unique identifier expression for each item |

## Full example

```html
<script lang="ts">
  import { $signal } from "decagrammaton";

  const students = $signal([
    { id: 1, name: "Aru", squad: "Problem Solver 68" },
    { id: 2, name: "Hina", squad: "Prefect Team" },
    { id: 3, name: "Iori", squad: "Problem Solver 68" },
  ]);

  function remove(id) {
    students.value = students.value.filter(s => s.id !== id);
  }
</script>

<template>
  <div>
    <div :for={student in students.value} :key={student.id}>
      <span>{student.name} — {student.squad}</span>
      <button @click={() => remove(student.id)}>Remove</button>
    </div>
  </div>
</template>
```

## How it works

At runtime, `:for` uses **keyed reconciliation**:

1. The iterable expression is evaluated inside an `effect()`
2. For each item, a scope is created with the binding variables (`item`, `index`)
3. The `:key` expression is evaluated per item to produce a unique key
4. New keys get fresh DOM nodes mounted; removed keys get their nodes cleaned up
5. Existing keys are left in place (not re-created)

This means:
- **Adding** an item mounts new DOM — existing items aren't touched
- **Removing** an item cleans up only that item's DOM
- **Reordering** is handled by key identity

::: info
Each iterated item is wrapped in a `<div>` at runtime for DOM isolation. This is an implementation detail for keyed reconciliation.
:::

## Combining with other directives

You can use `:for` on a component tag:

```html
<TaskItem
  :for={task in filteredTasks.value}
  :key={task.id}
  task={task}
  onToggle={toggleTask}
  onRemove={removeTask}
/>
```

You can also nest `:if` inside `:for`:

```html
<div :for={task in tasks.value} :key={task.id}>
  <span :if={task.done}>Done!</span>
  <span :else>{task.text}</span>
</div>
```

## Rules

- `:for` requires `:key` — the compiler throws an error without it
- `:for` uses `binding in iterable` syntax — anything else is a parse error
- The iterable must evaluate to an array
- Keys should be **stable** and **unique** — avoid using the index as a key when items can be reordered or removed
