// /*
import Counter from "./counter.deca";
import App from "./test.deca";
import { $state } from "./utils/states.ts";
import { $computed } from "./utils/computed.ts";

const container: HTMLElement = document.getElementById("app")!;

const CounterDef = Counter.toComponent({ $state, $computed });

App
  .compile({ $state, Counter: CounterDef })
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