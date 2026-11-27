import { parseSFC } from "./parse.ts";
import { compileSetup } from "./script.ts";
import { transform } from "./template/transform.ts";
import { generate } from "./template/codegen.ts";
import { DecaCompileError } from "./errors.ts";
import { scanCSSNetworkRisk } from "ark-of-atrahasis/validators";
import type { SFCDescriptor } from "@vue/compiler-sfc";

export function compile(source: string, filename: string, id: string, onDependency?: (path: string) => void): string {
  const descriptor = parseSFC(source, filename);
  const script = compileSetup(descriptor, id);
  if (onDependency) script.deps?.forEach(onDependency);
  const used = script.identifiers;
  function allocate(name: string) {
    while (used.has(name) || used.has(name + "_styles")) name += "_";
    used.add(name);
    return name;
  }
  const imports = new Map<string, string>();
  const render = allocate("render");
  const template = descriptor.template;
  if (template && !template.ast) throw new DecaCompileError("Template AST unavailable.");
  const body = generate(
    template ? transform(template.ast!) : [],
    collectStyles(descriptor.styles),
    (name) => {
      if (!imports.has(name)) imports.set(name, allocate(name));
      return imports.get(name)!;
    },
    render,
    script.bindings,
    script.bindings.__propsAliases,
  );
  const names = Array.from(imports, ([name, alias]) => (name === alias ? name : name + " as " + alias));
  return [
    `import { ${names.join(", ")} } from "decagrammaton/runtime";`,
    script.content,
    body,
    `${script.bindingName}.render = ${render};\nexport default ${script.bindingName};`,
  ].join("\n");
}
function collectStyles(styles: SFCDescriptor["styles"]): Array<string> {
  return styles.map((block) => {
    if ("src" in block.attrs) throw new DecaCompileError("<style src> is unsupported.");
    if (block.scoped) {
      throw new DecaCompileError("<style scoped> is not supported — only plain global <style>.");
    }
    if (block.module) {
      throw new DecaCompileError(
        "<style module> (CSS Modules) is not supported — only plain global <style>.",
      );
    }
    if (block.lang !== undefined && block.lang !== "css") {
      throw new DecaCompileError(
        `<style lang="${block.lang}"> is not supported — only plain global <style> (css).`,
      );
    }
    if (scanCSSNetworkRisk(block.content))
      throw new DecaCompileError("Network syntax in <style> is forbidden.");
    return block.content;
  });
}
