// /*
import App from "./__example/app.deca";

const container: HTMLElement = document.getElementById("app")!;

App
  .compile({ /* Counter: CounterDef */ })
  .mount(container);
// s*/

/*
import "ses";
import bundled from "../dist/assets/index-BIETWHVF?raw";
import { createSafeDocument } from "./__temporary/safe-document.ts";

lockdown();

const pluginRoot = document.getElementById("app")!;
const safeDocument = createSafeDocument(pluginRoot);

const compartment = new Compartment({
  "document": safeDocument,
});

compartment.evaluate(bundled);
// */