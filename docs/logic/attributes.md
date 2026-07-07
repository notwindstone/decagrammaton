# Attributes

Decagrammaton uses a simple convention to distinguish between static attributes, dynamic attributes, and event handlers in templates.

## Static Attributes

Plain HTML attributes are passed through as-is:

```html
<input type="text" placeholder="Enter text" disabled />
<div class="container" id="main" />
```

Boolean attributes (no value) are treated as `true`:

```html
<input disabled />
<!-- equivalent to disabled="" -->
```

## Expression Attributes `={expression}`

Wrap an attribute value in `{...}` to evaluate it as a JavaScript expression:

```html
<div class={isActive ? 'active' : 'inactive'} />
<input value={name.value} />
<button disabled={isLoading.value} />
```

Expression attributes are **reactive** — when any signal or computed accessed inside the expression changes, the attribute is automatically updated.

### Dynamic `class`

A common pattern is using template literals for conditional classes:

```html
<button
  class={`px-4 py-2 rounded ${isActive.value ? 'bg-blue-500 text-white' : 'bg-gray-100'}`}
/>
```

### Dynamic `style`

Pass an object to `style` to set individual CSS properties:

```html
<div style={{ backgroundColor: "red", width: `${progress.value}%` }} />
```

The object keys are CSS property names (camelCase), and the values are strings. Each property is applied reactively — only changed properties are updated.

::: tip
Dynamic `style` with an object is the only way to set inline styles. A `style="..."` string attribute is applied as a static attribute.
:::

## Event Attributes `@event={handler}`

Prefix an attribute name with `@` to bind an event handler:

```html
<button @click={handleClick}>Click me</button>
<input @input={handleInput} @change={handleChange} />
```

The handler receives a `SafeEvent` DTO (not a native `Event` object) when running inside a SES compartment. Available events:

| Attribute | Event |
|---|---|
| `@click` | click |
| `@dblclick` | dblclick |
| `@mousedown` | mousedown |
| `@mouseup` | mouseup |
| `@mouseenter` | mouseenter |
| `@mouseleave` | mouseleave |
| `@mousemove` | mousemove |
| `@pointerdown` | pointerdown |
| `@pointerup` | pointerup |
| `@pointermove` | pointermove |
| `@contextmenu` | contextmenu |
| `@keydown` | keydown |
| `@keyup` | keyup |
| `@focus` | focus |
| `@blur` | blur |
| `@touchstart` | touchstart |
| `@touchend` | touchend |
| `@touchmove` | touchmove |
| `@scroll` | scroll |
| `@change` | change |
| `@input` | input |

### Inline handlers

You can use arrow functions directly in the attribute:

```html
<button @click={() => count.value++}>+1</button>
<button @click={() => removeTask(task.id)}>Remove</button>
```

## `data-*` and `aria-*` Attributes

Data and ARIA attributes are supported with their standard prefixes:

```html
<div data-testid="main-container" aria-label="Main content" />
```

## Summary

| Syntax | Type | Reactive |
|---|---|---|
| `name="value"` | Static attribute | No |
| `name={expression}` | Expression attribute | Yes |
| `@event={handler}` | Event binding | N/A |
| `name` (no value) | Boolean attribute | No |
| `:if`, `:else-if`, `:else` | [Conditional directive](/logic/conditional-rendering) | Yes |
| `:for`, `:key` | [Iteration directive](/logic/iteration) | Yes |
