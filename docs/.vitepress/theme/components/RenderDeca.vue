<script setup lang="ts">
import { createSafeDocument } from "ark-of-atrahasis";
import { createApp } from "decagrammaton";
import { onMounted, onUnmounted, shallowRef } from "vue";

const { suffix, component } = defineProps<{
  "suffix"   : string;
  "component": unknown;
}>();

const cleanup = shallowRef<() => void>((): void => {});

onMounted(() => {
  const safeDocument = createSafeDocument(
    document.getElementById(`__mounting-point-${suffix}`)!,
  );
  // @ts-ignore DecaModule seems to be missing from the 'decagrammaton' package...
  const app = createApp(component);

  cleanup.value = app.mount(
    safeDocument.getElement(`__mounting-point-${suffix}`)!,
    safeDocument,
  );
});
onUnmounted(() => cleanup.value());
</script>

<template>
  <div :id="`__mounting-point-${suffix}`"></div>
</template>