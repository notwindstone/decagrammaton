
// UnoCSS essentials
import "virtual:uno.css";
// Resets all styles in a Tailwind-like way
import "@unocss/reset/tailwind.css";

import { createSafeDocument } from "../../src/__temporary/gui";
import { createApp } from "../../src";
import App from "./app.deca";

const gui = createSafeDocument(
  document.getElementById("app")!
);
const instance = createApp(App);

instance.mount(gui.getElement("app")!, gui);
