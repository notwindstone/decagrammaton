import { parseSFC, parseTemplate } from "./parse.ts";
import { compileSetup } from "./script.ts";
import { transform } from "./template/transform.ts";
import { generate } from "./template/codegen.ts";
import { DecaCompileError } from "./errors.ts";
import type { SFCDescriptor } from "@vue/compiler-sfc";

// The orchestrator: `.vue` source -> a full ES module string.
//
// Pipeline (ELEVENTH §2): parse() splits blocks -> compileScript() lowers
// <script setup> into a `const __deca_component__ = { setup }` -> baseParse()
// yields the template AST -> transform() walks it into our explicit-tree IR ->
// generate() emits `render(_ctx, gui)` as source. We stitch those into one
// module: runtime helper imports, the script, the render fn, then attach the
// render to the component and default-export it.
//
// The generated render body calls the runtime helpers (`renderEffect`, `on`,
// `setText`, `append`) — imported here from "decagrammaton/runtime".

export function compile(source: string, filename: string, id: string): string {
  const descriptor = parseSFC(source, filename);
  const script = compileSetup(descriptor, id);

  const templateSource = descriptor.template?.content ?? "";
  const ast = parseTemplate(templateSource);
  const ir = transform(ast);
  const styles = collectStyles(descriptor.styles);
  const renderFn = generate(ir, styles);

  return [
    `import { renderEffect, on, setText, mountStyle, setStyle, normalizeClass, append, createIf, rootIf, createFor, rootFor, createComponent, toModelNumber, modelArrayHas, modelArrayToggle } from "decagrammaton/runtime";`,
    ``,
    script.content,
    ``,
    renderFn,
    ``,
    `${script.bindingName}.render = render;`,
    `export default ${script.bindingName};`,
  ].join("\n");
}

// Extract CSS from the SFC's <style> blocks. Only plain global styles are
// supported this slice: `scoped`, CSS Modules (`module`), and preprocessor langs
// (`lang` other than css) are rejected fail-loud rather than silently dropped —
// a template author writing `<style scoped>` must see it isn't honored, not have
// leaking global styles. Surviving blocks map to their raw CSS content.
function collectStyles(styles: SFCDescriptor["styles"]): Array<string> {
  return styles.map((block) => {
    if (block.scoped) {
      throw new DecaCompileError("<style scoped> is not supported — only plain global <style> in this slice.");
    }
    if (block.module) {
      throw new DecaCompileError("<style module> (CSS Modules) is not supported — only plain global <style> in this slice.");
    }
    if (block.lang !== undefined && block.lang !== "css") {
      throw new DecaCompileError(`<style lang="${block.lang}"> is not supported — only plain global <style> (css) in this slice.`);
    }
    return block.content;
  });
}
