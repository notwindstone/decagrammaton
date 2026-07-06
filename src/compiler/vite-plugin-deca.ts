import type { Plugin } from "vite";
import { Parser } from "./parser.ts";
import { extractImports } from "./script.ts";

export function malkuth(): Plugin {
  return {
    name: "vite-plugin-deca",
    transform(source, id) {
      if (!id.endsWith(".deca")) return null;

      const filename = id.split("/").pop() ?? id;
      const parsed = new Parser(filename).put(source).parse();
      const scriptContent = parsed.script?.content ?? "";
      const templateJson = JSON.stringify(parsed.template);
      const styleContent = parsed.style?.content ?? "";
      const requiresArray = [...parsed.requires];
      const { imports, importedNames, cleanedScript } = extractImports(scriptContent);

      const decaComponentNames = new Set<string>();
      const processedImports = imports.map(imp => {
        const match = imp.match(/^import\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s+from\s+['"](.+\.deca)['"]/);

        if (match) {
          decaComponentNames.add(match[1]!);

          return imp.replace(/^(import\s+)([a-zA-Z_$][a-zA-Z0-9_$]*)/, "$1$2__raw");
        }

        return imp;
      });

      const hoistedImports = processedImports.length > 0
        ? processedImports.join("\n") + "\n"
        : "";

      const importedNamesJson = JSON.stringify(importedNames);
      const importEntries = importedNames.map(name => {
        if (decaComponentNames.has(name)) {
          return `${JSON.stringify(name)}: ${name}__raw.toComponent({})`;
        }

        return name;
      });
      const importsObject = importedNames.length > 0
        ? `const __imports = { ${importEntries.join(", ")} };`
        : "const __imports = {};";

      return {
        code: `
import { compileScript } from "decagrammaton/internal";
import { mount as __mount } from "decagrammaton";
${hoistedImports}
const __template = ${templateJson};
const __scriptContent = ${JSON.stringify(cleanedScript)};
const __importedNames = ${importedNamesJson};
${importsObject}

export const __styles = ${JSON.stringify(styleContent)};
export const __requires = ${JSON.stringify(requiresArray)};

export function compile(globals) {
  const allNames = [...__importedNames, ...Object.keys(globals)];
  const allValues = [...__importedNames.map(n => __imports[n]), ...Object.values(globals)];
  const compiled = compileScript(__scriptContent, allNames);
  const template = __template;
  const scope = { ...__imports, ...globals, ...compiled(...allValues) };
  return {
    template,
    scope,
    mount: (container, gui) => __mount(template, container, scope, gui),
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

export default { compile, toComponent, __styles, __requires };
`,
        map: null,
      };
    },
  };
}
