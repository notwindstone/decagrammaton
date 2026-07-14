import { parse as sfcParse, compileScript, rewriteDefault, type SFCDescriptor } from "@vue/compiler-sfc";
import type { BindingMetadata } from "@vue/compiler-core";
import ts from "typescript";

// Lower `<script setup>` into a plain `setup()` factory.
//
// compileScript() emits `export default { setup(...) {...} }`. rewriteDefault()
// turns that into `const <name> = { ... }` so we can attach our generated
// render() and re-export. We also surface bindingMetadata for later slices
// (the counter spine doesn't consume it — the runtime `_ctx` proxy unwraps
// signals dynamically instead).
//
// TypeScript (`<script setup lang="ts">`): neither @vue/compiler-sfc's
// compileScript() nor rewriteDefault() STRIPS types — compileScript leaves
// `interface`/`: T`/`ref<T>()` verbatim in its output and switches to a
// `_defineComponent(...)` wrapper that imports from `'vue'` (unresolvable here),
// and rewriteDefault then re-parses with @babel/parser WITHOUT the typescript
// plugin, so a bare `interface` throws "Unexpected reserved word". We therefore
// transpile the raw TS body to JS UP FRONT (transpileScript), rebuild the block
// as a plain `<script setup>` (no lang), and hand that JS descriptor to the
// normal path — so compileScript takes its untyped branch and never emits the
// `vue` import.

export interface CompiledScript {
  // Script source with the default export rewritten to a named const.
  content: string;
  // The const name the component object is bound to.
  bindingName: string;
  bindings: BindingMetadata;
}

// Transpile a TypeScript `<script lang="ts">` body down to plain JS so acorn
// (a JS-only parser) can handle it. `verbatimModuleSyntax` is required: the
// script's imports are referenced from the template, not the script body, so
// TypeScript would otherwise elide them as "unused" and break component wiring.
export function transpileScript(script: string): string {
  return ts.transpileModule(script, {
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      verbatimModuleSyntax: true,
    },
  }).outputText;
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

  // A TS block is transpiled to JS and the descriptor rebuilt as a plain
  // <script setup> before compileScript sees it (see the file header for why).
  const scriptDescriptor = isTypeScript(descriptor.scriptSetup.lang)
    ? lowerTypeScript(descriptor)
    : descriptor;

  const script = compileScript(scriptDescriptor, { id });
  const content = rewriteDefault(script.content, bindingName);

  return { content, bindingName, bindings: script.bindings ?? {} };
}

// Vue tags a block's language on `block.lang`. Treat both `ts` and `tsx` as
// TypeScript (a `<script setup>` never carries JSX in this framework, but tsx is
// still valid TS syntactically, so transpiling it is harmless and future-proof).
function isTypeScript(lang: string | undefined): boolean {
  return lang === "ts" || lang === "tsx";
}

// Transpile the TS `<script setup>` body to JS and re-parse a script-only SFC so
// the returned descriptor's `scriptSetup` is a plain (lang-less) JS block.
//
// Why re-parse rather than mutate `scriptSetup.content` in place: compileScript
// reads the block's source through the descriptor's `loc` offsets into the
// ORIGINAL SFC string, not through `.content` — so an in-place content swap is
// ignored and the raw TS is still parsed. Rebuilding a fresh `<script setup>`
// wrapper and parsing it gives compileScript correct offsets over the JS body.
//
// Only the script portion is rebuilt; the caller keeps using the ORIGINAL
// descriptor for the template (this new descriptor has no <template>).
function lowerTypeScript(descriptor: SFCDescriptor): SFCDescriptor {
  const jsBody = transpileScript(descriptor.scriptSetup!.content);
  const filename = descriptor.filename || "anonymous.vue";
  const rebuilt = `<script setup>\n${jsBody}\n</script>`;
  const { descriptor: jsDescriptor, errors } = sfcParse(rebuilt, { filename });
  if (errors.length > 0) {
    throw new Error(
      `Failed to re-parse transpiled <script setup lang="ts"> for ${filename}:\n` +
        errors.map((e) => e.message).join("\n"),
    );
  }
  return jsDescriptor;
}
