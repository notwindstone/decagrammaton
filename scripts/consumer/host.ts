import "ses";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { createSafeDocument } from "ark-of-atrahasis";

const document = new Window().document;
const root = document.body.appendChild(document.createElement("main"));
const sentinel = root.appendChild(document.createElement("hr"));
const bundle = await Bun.file("dist/fixture.js").text();
lockdown();
const gui = createSafeDocument(root as unknown as Element, { allowStylesheet: true });
const guest = new Compartment({ gui });
const mount = guest.evaluate(bundle + "\n(position => fixture.mount(gui, position))");
const empty = () => {
  assert.deepEqual([...root.childNodes], [sentinel]);
  assert.equal(document.head.querySelectorAll("style").length, 0);
};
const stop = mount();
const button = root.querySelector("button")!;
assert.equal(button.textContent, "ready");
button.click();
assert.equal(root.querySelector("p")?.textContent, "count=1!1");
const row = root.querySelector('[data-row="1"]')!;
assert.equal(row.style.color, "blue");
button.click();
assert.equal(row.style.color, "red");
assert.equal(row.style.fontSize, "");
root.querySelector(".reverse")!.click();
assert.equal(root.querySelectorAll("p")[1], row);
assert.equal(root.querySelector("input")!.readOnly, true);
assert.equal(root.querySelector("meter")!.value, 0.5);
const sheets = () => document.head.querySelectorAll("style").length;
assert.equal(sheets(), 2);
root.querySelector(".drop")!.click();
assert.equal(sheets(), 2);
root.querySelector(".drop")!.click();
assert.equal(sheets(), 1);
console.log("PASS mount and update");
stop();
stop();
empty();
const again = mount();
button.click();
assert.equal(root.querySelector("p")?.textContent, "count=0!0");
again();
empty();
console.log("PASS unmount and remount");
assert.throws(
  () => mount(Infinity),
  (e) => e.code === "INVALID_ARGUMENT",
);
empty();
const recover = mount();
assert.equal(root.querySelector("button")?.textContent, "ready");
recover();
empty();
const otherRoot = document.body.appendChild(document.createElement("section"));
const denied = new Compartment({ gui: createSafeDocument(otherRoot as unknown as Element) });
assert.throws(
  () => denied.evaluate(bundle + "\nfixture.mount(gui)"),
  (e) => e.code === "POLICY_DENIED",
);
assert.equal(otherRoot.childNodes.length, 0);
console.log("PASS fail and recover");
