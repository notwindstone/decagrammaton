# Attributes

## Static Attributes

Plain HTML attributes are passed through as-is:

```vue
<input type="text" placeholder="Enter text" disabled />
<div class="container" id="main"></div>
```

A valueless attribute (`disabled`) is treated as present/`true`.

::: warning Whitelist by construction
Decagrammaton compiles to the [Ark of Atrahasis](https://github.com/notwindstone/ark-of-atrahasis) safe DOM, which has **no** generic `setAttribute`. Every attribute maps to a specific Ark setter from an internal table. An attribute with no entry has nothing to call, so **the build fails** with a `DecaCompileError` rather than silently emitting it. The same is true for tags: an unknown tag (e.g. `<marquee>`) has no Ark creator and fails the build.
:::

## Bound Attributes `:attr="expression"`

Prefix an attribute with `:` (shorthand for `v-bind:`) to evaluate its value as a JavaScript expression:

```vue
<div :class="isActive ? 'active' : 'inactive'"></div>
<input :value="name" />
<button :disabled="isLoading"></button>
```

Bound attributes are **reactive** — when a signal or computed read inside the expression changes, the attribute is updated (each binding is wrapped in a render effect).

Dynamic attribute *names* (`:[attrName]="x"`) are **not** supported — there'd be no attribute name to whitelist at build time, so they throw.

### Dynamic `class`

`:class` accepts Vue's string / array / object shapes, and a static `class` is **merged** with a dynamic `:class`:

```vue
<div class="btn" :class="{ active: isActive, disabled: isDisabled }"></div>
<div :class="[base, isActive ? 'on' : 'off']"></div>
```

`class="btn" :class="{ active: true }"` produces `"btn active"`. Only one `:class` binding per element is allowed — combine multiple into a single array/object.

### Dynamic `style`

`:style` accepts a string, an object (camelCase CSS keys), or an array of those:

```vue
<div :style="{ backgroundColor: 'red', width: `${progress}%` }"></div>
```

Each property is applied through Ark's per-property style proxy. A plain `style="..."` string attribute is applied statically.

::: info
`:style` does not diff stale keys: if an object binding drops a key entirely between renders, the previously-set property is not explicitly cleared.
:::

## Event Handlers `@event="handler"`

Prefix with `@` (shorthand for `v-on:`) to bind an event handler:

```vue
<button @click="handleClick">Click me</button>
<input @input="handleInput" @change="handleChange" />
```

A handler may be a **method reference** (`@click="inc"`), a **member reference** (`@click="obj.method"`), an **arrow function** (`@click="() => inc()"`), or an **inline expression** (`@click="count++"`, which the compiler wraps so it runs on each event with `$event` in scope).

The handler receives a `SafeEvent` DTO (not a native `Event`) when running inside a SES compartment. Available events map to whitelisted Ark `on*` methods:

| Attribute      | Event       |
|----------------|-------------|
| `@click`       | click       |
| `@dblclick`    | dblclick    |
| `@mousedown`   | mousedown   |
| `@mouseup`     | mouseup     |
| `@mouseenter`  | mouseenter  |
| `@mouseleave`  | mouseleave  |
| `@mousemove`   | mousemove   |
| `@pointerdown` | pointerdown |
| `@pointerup`   | pointerup   |
| `@pointermove` | pointermove |
| `@contextmenu` | contextmenu |
| `@keydown`     | keydown     |
| `@keyup`       | keyup       |
| `@focus`       | focus       |
| `@blur`        | blur        |
| `@touchstart`  | touchstart  |
| `@touchend`    | touchend    |
| `@touchmove`   | touchmove   |
| `@scroll`      | scroll      |
| `@change`      | change      |
| `@input`       | input       |

An event with no entry throws at build time. Dynamic event names (`@[name]`) are not supported. `@event` on a **component** (child-to-parent events) is also rejected — there is no `emit`; use a callback prop instead.

::: warning Inline handlers must be expressions
An inline arrow handler must have an **expression** body. A block body throws:

```vue
<!-- ok -->
<button @click="count++">+1</button>
<button @click="() => remove(task.id)">Remove</button>

<!-- throws: statement-body functions are not supported -->
<button @click="() => { doA(); doB(); }">no</button>
```

Move multi-statement logic into a method in `<script setup>` and reference it by name.
:::

## `data-*` and `aria-*` Attributes

Data and ARIA attributes are supported via Ark's two-argument `setData` / `setAria`:

```vue
<div data-testid="main-container" :aria-label="label"></div>
```

## `v-model`

Two-way binding on form elements is covered by `v-model` — see the full rules in the sections below and on the [Iteration](/logic/iteration) and [Conditional Rendering](/logic/conditional-rendering) pages. It is supported on `<input>`, `<textarea>`, and single-select `<select>`, with `.lazy`, `.number`, and `.trim` modifiers. It is **not** supported on components.

## Summary

| Syntax | Type | Reactive |
|---|---|---|
| `name="value"` | Static attribute | No |
| `:name="expression"` | Bound attribute | Yes |
| `@event="handler"` | Event binding | N/A |
| `v-model="target"` | Two-way form binding | Yes |
| `name` (no value) | Boolean attribute | No |
| `v-if`, `v-else-if`, `v-else` | [Conditional directive](/logic/conditional-rendering) | Yes |
| `v-for`, `:key` | [Iteration directive](/logic/iteration) | Yes |
