<script setup lang="ts">
import { createSafeDocument } from "ark-of-atrahasis";
import { createApp } from "decagrammaton";
import Counter from "./Counter.deca";
import { onMounted, onUnmounted, shallowRef } from "vue";

const cleanup = shallowRef<() => void>((): void => {});

onMounted(() => {
  const safeDocument = createSafeDocument(
    document.getElementById("__mounting-point-counter")!,
  );
  const app = createApp(Counter);

  cleanup.value = app.mount(
    safeDocument.getElement("__mounting-point-counter")!,
    safeDocument,
  );
});
onUnmounted(() => cleanup.value());
</script>

<template>
  <div id="__mounting-point-counter"></div>
</template>