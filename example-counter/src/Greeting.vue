<script setup>
import { watchEffect } from "decagrammaton";
import Greeting from "./Greeting.vue";

const props = defineProps({ name: String, count: Number });

watchEffect(() => {
  console.log(props.count);
});
</script>

<template>
  <div>
    <p>Hello {{ name }}, the count is {{ count }}.</p>
    <Greeting v-if="count < 50" name="world" :count="count + 1" />
  </div>
</template>
