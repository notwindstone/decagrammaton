import type { Plugin } from "vite";
import { Parser } from "./parser.ts";

export function decaPlugin(): Plugin {
  return {
    name: "vite-plugin-deca",
    transform(source, id) {
      if (!id.endsWith(".deca")) return null;

      const filename = id.split("/").pop() ?? id;
      const parsed = new Parser(filename).put(source).parse();
      const scriptContent = parsed.script?.content ?? "";
      const templateJson = JSON.stringify(parsed.template);

      return {
        code: `
import { compileScript } from "/src/compiler/script.ts";

const __template = ${templateJson};
const __scriptContent = ${JSON.stringify(scriptContent)};

export function compile(globals) {
  const globalNames = Object.keys(globals);
  const globalValues = Object.values(globals);
  const compiled = compileScript(__scriptContent, globalNames);
  return {
    template: __template,
    scope: { ...globals, ...compiled(...globalValues) },
  };
}

export function toComponent(globals) {
  const globalNames = Object.keys(globals);
  const globalValues = Object.values(globals);
  const compiled = compileScript(__scriptContent, globalNames);
  return {
    template: __template,
    factory: () => ({ ...globals, ...compiled(...globalValues) }),
  };
}

export default { compile, toComponent };
`,
        map: null,
      };
    },
  };
}
