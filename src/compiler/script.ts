import { compileScript, rewriteDefault, type SFCDescriptor } from "@vue/compiler-sfc";
import type { BindingMetadata } from "@vue/compiler-core";

// Lower `<script setup>` into a plain `setup()` factory.
//
// compileScript() emits `export default { setup(...) {...} }`. rewriteDefault()
// turns that into `const <name> = { ... }` so we can attach our generated
// render() and re-export. We also surface bindingMetadata for later slices
// (the counter spine doesn't consume it — the runtime `_ctx` proxy unwraps
// signals dynamically instead).

export interface CompiledScript {
  // Script source with the default export rewritten to a named const.
  content: string;
  // The const name the component object is bound to.
  bindingName: string;
  bindings: BindingMetadata;
}

export function compileSetup(descriptor: SFCDescriptor, id: string): CompiledScript {
  const bindingName = "__deca_component__";

  if (!descriptor.scriptSetup) {
    // No <script setup>: synthesize an empty component so render still works.
    return {
      content: `const ${bindingName} = { setup() { return {} } };`,
      bindingName,
      bindings: {},
    };
  }

  const script = compileScript(descriptor, { id });
  const content = rewriteDefault(script.content, bindingName);

  return { content, bindingName, bindings: script.bindings ?? {} };
}
