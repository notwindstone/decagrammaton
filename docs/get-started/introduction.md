# Introduction

## What is Decagrammaton?

Decagrammaton is a declarative, lightweight, and reactive JavaScript framework that can run inside [Secure ECMAScript (SES)](https://endojs.org/) compartments.

It uses `.deca` single-file components — write your script logic and HTML template in one file, and Decagrammaton takes care of reactivity, DOM updates, and component composition.

##

## Motivation

Modern frontend frameworks are powerful, but they weren't designed with sandboxed execution in mind. Decagrammaton was built to power plugin UIs inside a Minecraft launcher called **Kaede**, where untrusted plugin code runs inside SES compartments. The framework needs to:

- Work with a **safe DOM wrapper** (`ark-of-atrahasis`) instead of the real `document`
- Never leak host-side references to plugin code
- Stay small — the entire runtime ships inside each plugin's sandbox

Beyond the security use case, Decagrammaton is a simple, approachable framework for anyone who likes Svelte-style single-file components with Vue-like reactivity primitives.

## Single-File Components

A `.deca` file has up to three sections:

```html
<script lang="ts">
  import { $signal } from "decagrammaton";

  const count = $signal(0);

  function increment() {
    count.value++;
  }
</script>

<template>
  <button @click={increment}>
    Clicked {count.value} times
  </button>
</template>
```

- **`<script>`** — optional, must appear at the top. Contains your component logic. Top-level declarations (`const`, `let`, `function`) are automatically available in the template — no explicit `return` needed.
- **`<template>`** — required, wraps your HTML markup. Supports expressions `{...}`, event handlers `@event={...}`, directives `:if`, `:for`, and component tags `<MyComponent />`.
- **`<style>`** — optional, can appear before or after `<template>`. Contains CSS that the framework extracts as metadata — your host application decides how to inject it.

::: tip
Decagrammaton does not include a built-in style solution. The recommended approach is atomic CSS via [UnoCSS](https://unocss.dev/) or [Tailwind CSS](https://tailwindcss.com/), applying classes directly in the template.
:::

## Setup

Install the package:

```bash
npm install decagrammaton
```

Register the Vite plugin in your `vite.config.ts`:

```ts
import { defineConfig } from "vite";
import { malkuth } from "decagrammaton/vite";

export default defineConfig({
  plugins: [malkuth()],
});
```

Add type support for `.deca` files in your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "types": ["decagrammaton/deca"]
  }
}
```

Create your entry point:

```ts
import { createApp } from "decagrammaton";
import App from "./app.deca";

const gui = createSafeDocument(document.getElementById("app")!);
const app = createApp(App);

app.mount(gui.getElement("app")!, gui);
```

::: info
The `createSafeDocument` function comes from `ark-of-atrahasis`, the safe DOM wrapper library. If you're not running inside a SES compartment, you can still use it — it wraps the real DOM and provides a secure API surface.
:::

## Project Structure

A typical Decagrammaton project looks like this:

```
src/
  main.ts          — entry point, creates and mounts the app
  app.deca         — root component
  my-component.deca — child component
vite.config.ts     — registers the malkuth() Vite plugin
uno.config.ts      — (optional) UnoCSS config with .deca file scanning
```
