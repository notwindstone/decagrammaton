# Introduction

## What is Decagrammaton?

Decagrammaton is a declarative, lightweight, and reactive JavaScript (JS) framework that can run inside [Secure ECMAScript (SES)](https://endojs.org/) compartments. It tries to avoid using a functionality that triggers [SES rejections](https://github.com/endojs/endo/tree/master/packages/ses/error-codes) (e.g., [SES_HTML_COMMENT_REJECTED](https://github.com/endojs/endo/blob/master/packages/ses/error-codes/SES_HTML_COMMENT_REJECTED.md)), which modern frameworks heavily rely on.

Decagrammaton runs inside the SES compartment while using a host-exposed safe DOM wrapper named [Ark of Atrahasis](https://github.com/notwindstone/ark-of-atrahasis). It does not require any globals other than those provided by Ark of Atrahasis.

## What is not Decagrammaton?

Decagrammaton is not another User Interface (UI) framework for your needs. It's not an alternative to React, Vue, Svelte, or others. It offers far inferior capabilities, lacks tooling for a pleasant Developer Experience, provides a suboptimal performance, and does not even work with a regular DOM. This framework is really niche, and I doubt you even need this for anything other than making UI in the sandboxed environment of Kaede.

## Motivation

SES compartment is arguably the best sandboxing mechanism for isolating an arbitrary JavaScript code while still running in a Webview's JavaScript engine. Code executed in SES compartments can communicate with the host in extremely fast way since it is executed in the same engine context. This also allows optimizations by a JIT-compiler to be made. By default, SES compartments expose only safe globals (`Object`, `Array`, `String`, etc.) and allow the host to extend those globals. Therefore, it is possible to pass down the compartment an object that can provide a function that fetches data only from specific URLs or a function that simply applies changes to the theme of an application. Overall, all these features introduce a great foundation for making your own sandboxed plugin system!

Unfortunately, despite such powerful capabilities, no existing UI frameworks were built for SES. However, one might ask why cannot we just use already existing UI frameworks? I have several answers for this question:

- UI frameworks were designed for the usage in regular environments. In environments that allow extending `window`, polluting prototypes, even using something as simple as HTML comments in JS that introduce headaches when dealing with SES.
- UI frameworks are built upon `document`. Replicating a 1:1 `document` replacement just for SES feels like unnecessary work. A library that provides a safe DOM wrapper for Decagrammaton, Ark of Atrahasis, builds its own API structure for that purpose, not trying to be a drop-in replacement for `document`.

Decagrammaton was made for the sandboxed plugin system of [Kaede](https://github.com/kaede-basement/kaede), but it might be used in my other projects alongside Ark of Atrahasis :3

## Single-File Components (SFC)

Decagrammaton uses files with an extension `.deca`. A `.deca` file may have three sections: `<script />`, `<style />`, and `<template />`. An example of a `.deca` syntax:

```html
<script lang="ts">
  import { $signal } from "decagrammaton";

  const count = $signal(0);

  function increment() {
    count.value++;
  }
</script>

<style>
  .example-button {
    background-color: #0d7a9e;
    color: #ffffff;

    border-radius: 6px;
  }
</style>

<template>
  <button class="example-button" @click={increment}>
    Clicked { count.value } times
  </button>
</template>
```

Some notes:

- If a `<script />` tag is present, it should always be at the top of the file.
- The top-level declarations in `<script />` are available in templates.
- There is no `<style scoped />` feature.

## Setup

Initialize a `vite` project (select `Vanilla` in the framework selection section):

```bash
bun create vite@latest
```

Install the package:

```bash
bun add decagrammaton
```

Register the Vite plugin in your `vite.config.ts`:

```ts
import { defineConfig } from "vite";
import { malkuth } from "decagrammaton/vite";

export default defineConfig({
  plugins: [malkuth()],
});
```

Add a type support for `.deca` files in your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "types": ["decagrammaton/deca"]
  }
}
```

Create your entry point:

```ts
// If you are not using SES, uncomment the next line and install that package
// import { createSafeDocument } from "ark-of-atrahasis";
import { createApp } from "decagrammaton";
import App from "./app.deca";

// 'scopedThis' acts a compartment-scoped global variable that exposes 'createSafeDocument' from "ark-of-atrahasis"
const { createSafeDocument } = scopedThis;

// The provided string is an id that is used for document#getElementById
const safeDocument = createSafeDocument("app");
const app = createApp(App);

app.mount(
  safeDocument.getElement("app")!,
  safeDocument,
);
```
