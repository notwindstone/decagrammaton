<script setup>
import { inject } from "decagrammaton";

const scopedFailureCount = inject("hii");
</script>

<template>
  <div>
    Deeply Injected {{ scopedFailureCount }}
  </div>
</template>