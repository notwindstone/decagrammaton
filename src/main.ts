// /*
import Counter from "./counter.deca";
import App from "./test.deca";

const container: HTMLElement = document.getElementById("app")!;

const CounterDef = Counter.toComponent({});

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