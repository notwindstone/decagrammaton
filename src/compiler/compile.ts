import { parseSFC, parseTemplate } from "./parse.ts";
import { compileSetup } from "./script.ts";
import { transform } from "./template/transform.ts";
import { generate } from "./template/codegen.ts";

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
  const renderFn = generate(ir);

  return [
    `import { renderEffect, on, setText, append, createIf, rootIf, createFor, rootFor, createComponent } from "decagrammaton/runtime";`,
    ``,
    script.content,
    ``,
    renderFn,
    ``,
    `${script.bindingName}.render = render;`,
    `export default ${script.bindingName};`,
  ].join("\n");
}
