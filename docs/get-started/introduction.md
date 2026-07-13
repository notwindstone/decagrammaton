# Introduction

## What is Decagrammaton?

Decagrammaton is a [Vue 3](https://vuejs.org/)-like, declarative, lightweight, and reactive JavaScript (JS) framework that can run inside [Secure ECMAScript (SES)](https://endojs.org/) compartments without `document`. It tries to avoid using a functionality that triggers [SES rejections](https://github.com/endojs/endo/tree/master/packages/ses/error-codes) (e.g., [SES_HTML_COMMENT_REJECTED](https://github.com/endojs/endo/blob/master/packages/ses/error-codes/SES_HTML_COMMENT_REJECTED.md)), which modern frameworks heavily rely on.

Decagrammaton runs inside the SES compartment while using a host-exposed safe DOM wrapper named [Ark of Atrahasis](https://github.com/notwindstone/ark-of-atrahasis). It does not require any globals other than those provided in SES compartments by default.

## What is not Decagrammaton?

Decagrammaton is not another User Interface (UI) framework for your needs. It is not a lightweight Vue 3. It is not a regular alternative to React, Vue, Angular, Svelte, or others. It offers far inferior capabilities, lacks most tooling for a pleasant Developer Experience, and does not even work with a regular DOM. This framework is really niche, and I doubt you even need this for anything other than making UI in the sandboxed environment of [Kaede](https://github.com/kaede-basement/kaede).

## Motivation

SES compartment is arguably the best sandboxing mechanism for isolating an arbitrary JavaScript code while still running in a Webview's JavaScript engine. Code executed in SES compartments can communicate with the host in an extremely fast way since it is executed in the same engine context. This also allows optimizations by a JIT-compiler to be made. By default, SES compartments expose only safe globals (`Object`, `Array`, `String`, etc.) and allow the host to extend those globals. Therefore, it is possible to pass an object down to the compartment that can provide a function that fetches data only from specific URLs or a function that simply applies changes to the theme of an application. Overall, all these features introduce a great foundation for making one's own sandboxed plugin system!

Unfortunately, despite such powerful capabilities, no existing UI frameworks were built for SES. However, one might ask why can we not just use already existing UI frameworks? I have several answers for this question:

- UI frameworks were designed for the usage in regular environments. In environments that allow accessing unsafe variety of globals or objects, polluting prototypes, even using something as simple as HTML comments in JS that introduce headaches when dealing with SES.
- UI frameworks are built upon `document`. Replicating a 1:1 `document` replacement just for SES feels like unnecessary work. A library that provides a safe DOM wrapper for Decagrammaton, Ark of Atrahasis, builds its own API structure for achieving an easy way to handle sandboxing, not trying to be a drop-in replacement for `document`. Ark of Atrahasis is built with [Principle of Least Privilege](https://en.wikipedia.org/wiki/Principle_of_least_privilege) and default-deny policy.

Decagrammaton was made for the sandboxed plugin system of Kaede, but it might be used in my other projects alongside Ark of Atrahasis :3

## Single-File Components (SFC)

Decagrammaton uses Vue 3-like syntax in `.vue` files. A component may have three sections: `<script setup>`, `<style>`, and `<template>`. The semantics of Decagrammaton usually match Vue 3. An example of the classic counter component:

```vue
<script setup>
import { ref } from "decagrammaton";

const count = ref<number>(0);

function increment() {
  count.value++;
}
</script>

<style>
  .example-button {
    background-color: #444444;
    color: #ffffff;

    border-radius: 6px;
    padding: 4px 8px;

    &:active {
      background-color: #333333;
    }
  }
</style>

<template>
  <button class="example-button" @click="increment">
    Clicked {{ count }} times
  </button>
</template>
```

Output:

<Counter />

## Setup

Initialize a `vite` project (select `Vue` in the framework selection section):

```bash
bun create vite@latest
```

Install the package:

```bash
bun add decagrammaton
```

If you want to use Decagrammaton outside the Kaede plugins, also install `ark-of-atrahasis`:

```bash
bun add ark-of-atrahasis
```

Make your `vue` package a dev dependency:

```bash
bun add -d vue
```

Register the Vite plugin in your `vite.config.ts`:

```ts
import { defineConfig } from "vite";
import { malkuth } from "decagrammaton/vite";

export default defineConfig({
  plugins: [malkuth()],
});
```

Now, `main.ts`:

```ts
import { createApp } from "decagrammaton";
import Counter from "./Counter.vue";

const { createSafeDocument } = scopedThis;
// If you want to use Decagrammaton outside the Kaede plugins, remove the line above and uncomment the next one
// import { createSafeDocument } from "ark-of-atrahasis";

// 'id' is used in 'document#getElementById'
const id = "app";
const gui = createSafeDocument(id);
const app = createApp(Counter);

// 'unmount' removes the mounted UI
const unmount = app.mount(gui.getElement(id)!, gui);
```
