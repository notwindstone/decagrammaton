import { createApp } from "decagrammaton";
import { createSafeDocument } from "ark-of-atrahasis";
import Counter from "./Counter.vue";

const gui = createSafeDocument(document.getElementById("app")!, { allowStylesheet: true });
createApp(Counter).mount(gui);
