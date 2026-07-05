import type { Plugin } from "vite";
import { Parser } from "./parser.ts";
import { extractImports } from "./script.ts";

export function decaPlugin(): Plugin {
  return {
    name: "vite-plugin-deca",
    transform(source, id) {
      if (!id.endsWith(".deca")) return null;

      const filename = id.split("/").pop() ?? id;
      const parsed = new Parser(filename).put(source).parse();
      const scriptContent = parsed.script?.content ?? "";
      const templateJson = JSON.stringify(parsed.template);
      const { imports, importedNames, cleanedScript } = extractImports(scriptContent);

      const hoistedImports = imports.length > 0
        ? imports.join("\n") + "\n"
        : "";

      const importedNamesJson = JSON.stringify(importedNames);
      const importsObject = importedNames.length > 0
        ? `const __imports = { ${importedNames.join(", ")} };`
        : "const __imports = {};";

      return {
        code: `
import { compileScript } from "/src/compiler/script.ts";
import { mount as __mount } from "/src/utils/render.ts";
${hoistedImports}
const __template = ${templateJson};
const __scriptContent = ${JSON.stringify(cleanedScript)};
const __importedNames = ${importedNamesJson};
${importsObject}

export function compile(globals) {
  const allNames = [...__importedNames, ...Object.keys(globals)];
  const allValues = [...__importedNames.map(n => __imports[n]), ...Object.values(globals)];
  const compiled = compileScript(__scriptContent, allNames);
  const template = __template;
  const scope = { ...__imports, ...globals, ...compiled(...allValues) };
  return {
    template,
    scope,
    mount: (container) => __mount(template, container, scope),
  };
}

export function toComponent(globals) {
  const allNames = [...__importedNames, ...Object.keys(globals)];
  const allValues = [...__importedNames.map(n => __imports[n]), ...Object.values(globals)];
  const compiled = compileScript(__scriptContent, allNames);
  return {
    template: __template,
    factory: () => ({ ...__imports, ...globals, ...compiled(...allValues) }),
  };
}

export default { compile, toComponent };
`,
        map: null,
      };
    },
  };
}
