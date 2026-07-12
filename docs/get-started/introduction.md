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

Decagrammaton uses Vue 3-like syntax in `.vue` files. A component may have three sections: `<script setup>`, `<style>`, and `<template>`. The semantics of Decagrammaton usually match Vue 3. An example of:

```vue
<script setup>
  import { signal } from "decagrammaton";

  const count = signal(0);

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

Some notes:

- Reactivity comes from `@sigrea/core` — write `count.value` in `<script setup>`, but in templates the compiler auto-unwraps signals, so `{{ count }}` is enough (no `.value`).
- The top-level declarations in `<script setup>` are available in the template.
- This is Vue 3 syntax, but **not** Vue 3 semantics — a large subset is intentionally unsupported. See [Differences from Vue 3](/get-started/differences) for the full list.

## Setup

Initialize a `vite` project (select `Vanilla` in the framework selection section):

```bash
bun create vite@latest
```

Install the package:

```bash
bun add decagrammaton
```

Register the Vite plugin in your `vite.config.ts`. The plugin, `malkuth`, compiles every `.vue` file into imperative Ark API calls:

```ts
import { defineConfig } from "vite";
import { malkuth } from "decagrammaton/vite";

export default defineConfig({
  plugins: [malkuth()],
});
```

Create your entry point. `createApp(RootComponent).mount(element, gui)` takes an Ark `SafeDocument` as the rendering target instead of the browser DOM:

```ts
import { createApp } from "decagrammaton";
import { createSafeDocument } from "ark-of-atrahasis";
import Counter from "./Counter.vue";

// The provided string is an id used for the safe document's mount lookup.
const gui = createSafeDocument("app");
const app = createApp(Counter);

// mount() returns a cleanup function that tears down the whole reactive subtree.
app.mount(gui.getElement("app")!, gui);
```

Inside a SES compartment, `createSafeDocument` is exposed by the host rather than imported directly — the compartment only sees the globals Ark of Atrahasis hands it, so nothing here needs `window` or `document`.
