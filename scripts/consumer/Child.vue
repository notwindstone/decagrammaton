<script setup lang="ts">
import { defaults as _mergeDefaults, labelKey as _defineComponent } from "./defaults";
import { inject } from "decagrammaton";
withDefaults(defineProps<{ row: number; count: number; suffix?: string }>(), _mergeDefaults);
const label = inject(_defineComponent);
</script>
<template><p :data-row="row" style="color:red" :style="count % 2 ? {color: 'blue', fontSize: '12px'} : {}">{{label}}={{count}}{{suffix}}<slot/></p></template>

<style>p { padding: 2px }</style>
