<script setup>
import { watchEffect, inject } from "decagrammaton";
import Greeting from "./Greeting.vue";
import DeeplyNested from "./DeeplyNested.vue";

const props = defineProps({ name: String, count: Number });

const scopedFailureCount = inject("hii");
</script>

<template>
  <div>
    <p>Hello {{ name }}, the count is {{ count }}. inject: {{ scopedFailureCount }}</p>
    <Greeting v-if="count < 50" name="world" :count="count + 1" />
    <!-- Once the 'count' is changed (on click), the DeeplyNested component becomes 'Deeply Injected' instead of 'Deeply Injected <number>' -->
    <DeeplyNested v-if="count >= 50" />
  </div>
</template>
