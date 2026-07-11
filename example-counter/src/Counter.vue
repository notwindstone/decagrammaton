<script setup>
import { signal, computed, provide } from "decagrammaton";
import Greeting from "./Greeting.vue";

const count = signal(0);
function inc() {
  count.value++;
}

const show = signal(true);
function toggle() {
  show.value = !show.value;
}

const computedShow = computed(() => count.value % 2 === 0);

// --- prefixer edge-case fixtures ---
const failureCount = signal(0);
const error = signal(null);
const releases = signal({ Name: "v1.2.3" });
const label = signal("Downloading %s...");
const items = signal([{ title: "alpha" }, { title: "beta" }]);
const selectedIndex = signal(0);

function fail() {
  failureCount.value++;
  error.value = { message: "network unreachable" };
}
function recover() {
  error.value = null;
}

// --- slice 4: reorderable keyed v-for list ---
const nextId = signal(4);
const rows = signal([
  { id: 1, name: "apple" },
  { id: 2, name: "banana" },
  { id: 3, name: "cherry" },
]);
function addRow() {
  const id = nextId.value++;
  rows.value = [...rows.value, { id, name: "item-" + id }];
}
function removeFirst() {
  rows.value = rows.value.slice(1);
}
function reverseRows() {
  rows.value = [...rows.value].reverse();
}

provide("hii", failureCount);
</script>

<template>
  <button @click="inc">{{ count }}</button>
  <button @click="count++">inline ++</button>

  <!-- slice 6: child component with static + dynamic (reactive) props -->
  <Greeting name="world" :count="count" />
  <button @click="toggle">toggle</button>
  <p v-if="count % 2 === 0">visible ({{ show }})</p>
  <div v-else>hidden ({{ computedShow }})</div>

  <!-- edge cases: exercise the acorn prefixer's trickier paths -->
  <hr />
  <button @click="fail">fail</button>
  <button @click="recover">recover</button>
  <button @click="failureCount = failureCount + 1">bump failures</button>

  <!-- v-if with a comparison against a non-allowed global (null literal is fine) -->
  <span v-if="failureCount > 0">Fetching failed {{ failureCount }} times.</span>

  <!-- optional chaining: error?.message must stay a single member chain -->
  <span v-if="error !== null">Error: {{ error?.message }}.</span>
  <span v-else @click="selectedIndex++">No error</span>

  <!-- ternary + optional-call + member-key: only free idents get _ctx. -->
  <p>{{ error === null ? label?.replace?.("%s", releases.Name) : "no release" }}</p>

  <!-- allowed global stays bare (Math), computed member key prefixes -->
  <p>Max: {{ Math.max(count, 0) }}</p>
  <p>Item: {{ items?.[selectedIndex]?.title ?? "none" }}</p>

  <!-- slice 4: keyed v-for. Reorder/add/remove must keep row identity -->
  <hr />
  <button @click="addRow">add row</button>
  <button @click="removeFirst">remove first</button>
  <button @click="reverseRows">reverse</button>
  <ul>
    <li v-for="(row, i) in rows" :key="row.id">{{ i }}: {{ row.name }} (#{{ row.id }})</li>
  </ul>
</template>
