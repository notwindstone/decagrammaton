<script setup lang="ts">
import { createSafeDocument } from "ark-of-atrahasis";
import { onMounted, onUnmounted, shallowRef } from "vue";

const { suffix } = defineProps<{
  "suffix"   : string;
  // "component": DecaModule;
}>();

const cleanup = shallowRef<() => void>((): void => {});

onMounted(() => {
  return;
  const safeDocument = createSafeDocument(
    document.getElementById(`__mounting-point-${suffix}`)!,
  );
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