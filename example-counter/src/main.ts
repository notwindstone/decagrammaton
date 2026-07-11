import { createApp } from "decagrammaton";
import { createSafeDocument } from "ark-of-atrahasis";
import Counter from "./Counter.vue";

const gui = createSafeDocument("app");
const app = createApp(Counter);

app.mount(gui.getElement("app")!, gui);

gui.createStyle().setCSS("* { padding: 0; margin: 0 }");
