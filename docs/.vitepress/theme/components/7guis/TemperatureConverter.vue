<script setup lang="ts">
import TemperatureConverter from "./TemperatureConverter.deca";
import RenderDeca from "../RenderDeca.vue";
</script>

<template>
  <RenderDeca suffix="temperature-converter" :component="TemperatureConverter" />
</template>/