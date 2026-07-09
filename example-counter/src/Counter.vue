<script setup>
import { signal } from "decagrammaton";

const count = signal(0);
function inc() {
  count.value++;
}
</script>

<template>
  <button @click="inc">{{ count }}</button>
</template>
