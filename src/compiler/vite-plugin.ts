import type { Plugin } from "vite";
import { compile } from "./compile.ts";

// The vite plugin: on a `.vue` id, run the compiler and hand vite back a plain
// ES module. compile() already returns a full module string (runtime imports +
// script + render fn + default export), so this is far thinner than the old
// `.deca` plugin — no runtime AST interpreter, no factory building here.
export function malkuth(): Plugin {
  return {
    name: "vite-plugin-decagrammaton",
    enforce: "pre",
    transform(source, id) {
      if (!id.endsWith(".vue")) return null;

      const filename = id.split("/").pop() ?? id;
      const code = compile(source, filename, id);

      return { code, map: null };
    },
  };
}
