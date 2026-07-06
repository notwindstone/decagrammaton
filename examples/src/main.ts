import { createSafeDocument } from "../../src/__temporary/gui";
import { createApp } from "../../src";
import App from "./app.deca";

const gui = createSafeDocument(
  document.getElementById("app")!
);
const instance = createApp(App);

instance
  .provide({ "globalVariable": "Hii" })
  .mount(gui.getElement("app")!, gui);
