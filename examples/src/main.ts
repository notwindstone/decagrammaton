// UnoCSS essentials
import "virtual:uno.css";
// Resets all styles in a Tailwind-like way
import "@unocss/reset/tailwind.css";

import { createApp } from "../../src";
import App from "./app.deca";
import { createSafeDocument } from "ark-of-atrahasis";

const gui = createSafeDocument(
  document.getElementById("app")!
);
const instance = createApp(App);

instance.mount(gui.getElement("app")!, gui);
