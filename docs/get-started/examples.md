# Examples

Here are some `.deca` component examples to get a feel for the framework.

## Counter

A minimal reactive counter:

```html
<script lang="ts">
  import { $signal } from "decagrammaton";

  const count = $signal(0);

  function increment() {
    count.value++;
  }
</script>

<template>
  <div>
    <p>Count: {count.value}</p>
    <button @click={increment}>+1</button>
  </div>
</template>
```

## Text Input

Two-way-ish binding with an input field:

```html
<script lang="ts">
  import { $signal } from "decagrammaton";

  const name = $signal("Sensei");

  function handleInput(event) {
    name.value = event.target.value;
  }
</script>

<template>
  <div>
    <input type="text" placeholder="Enter your name" @input={handleInput} />
    <p>Hello, {name.value}!</p>
  </div>
</template>
```

## Conditional Rendering

Show different content based on state:

```html
<script lang="ts">
  import { $signal } from "decagrammaton";

  const loggedIn = $signal(false);

  function toggle() {
    loggedIn.value = !loggedIn.value;
  }
</script>

<template>
  <div>
    <p :if={loggedIn.value}>Welcome back, Sensei!</p>
    <p :else>Please log in.</p>
    <button @click={toggle}>
      {loggedIn.value ? "Log out" : "Log in"}
    </button>
  </div>
</template>
```

## List Rendering

Render a list with `:for` and `:key`:

```html
<script lang="ts">
  import { $signal } from "decagrammaton";

  const items = $signal([
    { id: 1, name: "Aru" },
    { id: 2, name: "Hina" },
    { id: 3, name: "Iori" },
  ]);
</script>

<template>
  <ul>
    <li :for={item in items.value} :key={item.id}>
      {item.name}
    </li>
  </ul>
</template>
```

## Computed + Dynamic Styles

Using `$computed` for derived state and dynamic `style` attributes:

```html
<script lang="ts">
  import { $signal, $computed } from "decagrammaton";

  const progress = $signal(30);
  const label = $computed(() =>
    progress.value >= 100 ? "Complete!" : `${progress.value}%`
  );

  function advance() {
    progress.value = Math.min(100, progress.value + 10);
  }
</script>

<template>
  <div>
    <div style={{ width: "200px", backgroundColor: "#eee", borderRadius: "8px" }}>
      <div
        style={{
          width: `${progress.value}%`,
          height: "24px",
          backgroundColor: "#6366f1",
          borderRadius: "8px",
        }}
      ></div>
    </div>
    <p>{label.value}</p>
    <button @click={advance}>+10%</button>
  </div>
</template>
```

## Component Composition

Split your UI into multiple `.deca` files:

**`greeting.deca`**
```html
<script lang="ts">
  const { name } = defineProps();
</script>

<template>
  <p>Hello, {name}!</p>
</template>
```

**`app.deca`**
```html
<script lang="ts">
  import Greeting from "./greeting.deca";
</script>

<template>
  <div>
    <Greeting name="Sensei" />
    <Greeting name="Arona" />
  </div>
</template>
```

Components are referenced by their import name. The tag name must start with an **uppercase letter** — that's how Decagrammaton distinguishes components from HTML elements.

## Provide / Inject

Share data across the component tree without prop drilling:

**`app.deca`**
```html
<script lang="ts">
  import { $signal } from "decagrammaton";
  import Header from "./header.deca";

  const theme = $signal("dark");
  provide('theme', theme);
</script>

<template>
  <Header />
</template>
```

**`header.deca`**
```html
<script lang="ts">
  const theme = inject('theme');
</script>

<template>
  <div class={theme.value === 'dark' ? 'bg-gray-900 text-white' : 'bg-white text-black'}>
    Current theme: {theme.value}
  </div>
</template>
```
