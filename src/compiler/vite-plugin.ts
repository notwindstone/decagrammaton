import { invalidateTypeCache } from "@vue/compiler-sfc";
import type { Plugin } from "vite";
import { compile } from "./compile.ts";

export function malkuth(): Plugin {
  const dependencies = new Map<string, Set<string>>();
  function invalidateDependencies(file: string) {
    const affected: string[] = [];
    const stale = new Set([file]);
    for (const [id, deps] of dependencies) {
      if (!deps.has(file)) continue;
      affected.push(id);
      for (const dep of deps) stale.add(dep);
    }
    for (const dep of stale) invalidateTypeCache(dep);
    return affected;
  }
  return {
    name: "vite-plugin-decagrammaton",
    enforce: "pre",
    transform(source, id) {
      const [path, query] = id.split("?");
      const params = new URLSearchParams(query);
      if (!path.endsWith(".vue") || params.has("raw") || params.has("url")) return null;

      const deps = new Set<string>();
      const code = compile(source, path, id, (dep) => {
        this.addWatchFile(dep);
        deps.add(dep);
      });
      if (deps.size) dependencies.set(id, deps);
      else dependencies.delete(id);
      return { code, map: null };
    },
    watchChange(file, { event }) {
      invalidateDependencies(file);
      if (event === "delete")
        for (const id of dependencies.keys())
          if (id.split("?")[0] === file) dependencies.delete(id);
    },
    handleHotUpdate({ file, modules, server }) {
      const affected = new Set(modules);
      for (const id of invalidateDependencies(file)) {
        const mod = server.moduleGraph.getModuleById(id);
        if (mod) {
          server.moduleGraph.invalidateModule(mod);
          affected.add(mod);
        }
      }
      return [...affected];
    },
  };
}
