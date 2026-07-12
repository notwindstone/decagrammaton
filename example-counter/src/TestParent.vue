<script setup>
import DemoGrid from './Test.vue'
import { watchEffect, signal } from 'decagrammaton'

const searchQuery = signal('')
const gridColumns = ['name', 'power']
const gridData = [
  { name: 'Chuck Norris', power: Infinity },
  { name: 'Bruce Lee', power: 9000 },
  { name: 'Jackie Chan', power: 7000 },
  { name: 'Jet Li', power: 8000 }
]
</script>

<template>
  <div id="search">
    Search <input name="query" v-model="searchQuery" />
    {{ searchQuery }}
    <DemoGrid
      :data="gridData"
      :columns="gridColumns"
      :filterKey="searchQuery">
    </DemoGrid>
  </div>
</template>