<script setup lang="ts">
import CRUD from "./CRUD.deca";
import RenderDeca from "../RenderDeca.vue";
</script>

<template>
  <RenderDeca suffix="crud" :component="CRUD" />
</template>/