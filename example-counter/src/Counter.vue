<script setup>
import { signal, computed } from "decagrammaton";

const count = signal(0);
function inc() {
  count.value++;
}

const show = signal(true);
function toggle() {
  show.value = !show.value;
}

const computedShow = computed(() => count.value % 2 === 0);
</script>

<template>
  <button @click="inc">{{ count }}</button>
  <button @click="count++">inline ++</button>
  <button @click="toggle">toggle</button>
  <p v-if="count % 2 === 0">visible ({{ show }})</p>
  <div v-else>hidden ({{ computedShow }})</div>
</template>
