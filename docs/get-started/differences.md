# Differences from Vue 3

Decagrammaton uses Vue 3 SFC **syntax**, but compiles to the [Ark of Atrahasis](https://github.com/notwindstone/ark-of-atrahasis) safe DOM inside an SES sandbox. Anything that can't be expressed as a whitelisted Ark call is **rejected at build time** with a `DecaCompileError` — nothing fails silently.

If you know Vue 3, this page is the short list of what's missing or restricted.

## Templates

- **Single root only.** A component, `v-if` branch, or `v-for` row must have exactly one root element/component — no fragments, no bare text, no sibling roots.
- **No `<template>` grouping.** You can't wrap a `v-if`/`v-for` group in a `<template>` tag — use a real element (e.g. `<div>`).
- **Whitelisted tags only.** Every tag maps to an Ark creator. An unknown tag (e.g. `<marquee>`) has no creator and fails the build.
- **Whitelisted attributes only.** There is no generic `setAttribute` — each attribute maps to a specific Ark setter. An unmapped attribute fails the build.
- **No dynamic attribute or event names** — `:[attr]="x"` and `@[event]="h"` throw (nothing to whitelist at build time).
- **Inline handlers must be expressions.** `@click="() => { a(); b(); }"` (block body) throws — move it into a method.

## Components

- **No events / `emit`.** There is no `defineEmits` or `emit` channel. Use a **callback prop** instead (`:onAdd="addTask"`).
- **No component `v-model` / `defineModel`.** Two-way binding only works on native `<input>`/`<textarea>`/`<select>`.
- **Props are read-only, one-way.** Assigning to a prop throws. Signals passed as props arrive **unwrapped**; use a `deepSignal` to share mutable state.
- **Default slot only.** No named slots, no scoped slots, no slot forwarding.
- **No dynamic components** (`<component :is="...">`).
- **No built-ins**: no `<Teleport>`, `<Suspense>`, `<KeepAlive>`, `<Transition>`.

## Reactivity & API

- **`provide` / `inject` are real imports** from `decagrammaton`, not macros — and are **setup-only**.
- **No root `app.provide()`** — provide/inject works at the component-instance level only.
- **`.value` in script, not in templates** — the template context auto-unwraps signals on read.

## Styles

- **No `scoped`, no CSS modules, no `lang` preprocessors.** `<style>` is plain global CSS (minified at build).

## Reactivity gotchas

- **`:style` doesn't diff stale keys** — dropping a key from an object binding between renders doesn't clear the previously-set property.
- **`<select multiple>` isn't supported** by `v-model` — single-select only.
