import { parse, type SFCDescriptor } from "@vue/compiler-sfc";
import { parse as parseDOM, parserOptions } from "@vue/compiler-dom";
import type { ParserOptions, RootNode } from "@vue/compiler-core";
import { DecaCompileError } from "./errors.ts";

// Vue calls getNamespace for each opening tag, then isVoidTag when that
// tag ends. Its closing-tag path calls only isVoidTag. Returning false on
// that path lets Vue diagnose a stray </input> instead of discarding it.
function templateOptions(): ParserOptions {
  let opening = false;
  return {
    getNamespace(...args) {
      opening = true;
      return parserOptions.getNamespace!(...args);
    },
    isVoidTag(tag) {
      const voidOpening = opening && parserOptions.isVoidTag!(tag);
      opening = false;
      return voidOpening;
    },
  };
}
export function parseSFC(source: string, filename: string): SFCDescriptor {
  const { descriptor, errors } = parse(source, { filename, ignoreEmpty: false, templateParseOptions: templateOptions() });
  if (errors.length)
    throw new DecaCompileError(filename + "\n" + errors.map((e) => e.message).join("\n"));
  return descriptor;
}
export function parseTemplate(template: string): RootNode {
  return parseDOM(template, {
    ...templateOptions(),
    onError(e) {
      throw new DecaCompileError(e.message);
    },
  });
}
