<script setup lang="ts">
import { ref, provide, onMounted } from "decagrammaton";
import ChildRow from "./Child.vue";
withDefaults(defineProps<{ position?: number }>(), { position: 0 });
const count = ref(0);
const rows = ref([1, 2]);
const reverse = () => { rows.value = [...rows.value].reverse(); };
const drop = () => { rows.value = rows.value.slice(1); };
const render = ref("pending");
const on = () => count.value++;
onMounted(() => { render.value = "ready"; });
provide("label", "count");
</script>
<template>
  <button @click.prevent.stop="on">{{render}}</button>
  <button class="reverse" @click="reverse">reverse</button><button class="drop" @click="drop">drop</button>
  <input readonly min="2"/><meter min="0.2" value="0.5"/>
  <child-row v-for="row in rows" :key="row" :row="row" :count="count"><i>{{count}}</i></child-row><bdi :tabindex="position">end</bdi>
</template>
<style>button { color: blue }</style>
