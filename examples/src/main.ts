import { createApp } from "../../src";
import App from "./app.deca";

const container: HTMLElement = document.getElementById("app")!;
const instance = createApp(App);

instance
  .provide({ "globalVariable": "Hii" })
  .mount(container);
