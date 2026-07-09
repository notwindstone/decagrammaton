import { parse as sfcParse, type SFCDescriptor } from "@vue/compiler-sfc";
import { baseParse, type RootNode } from "@vue/compiler-core";

// Frontend parse layer — all from @vue. We use ONLY parse() (split blocks) and
// baseParse() (template AST). We deliberately do NOT call compileTemplate(),
// which would drag in runtime-core assumptions and emit a VDOM render fn.

export function parseSFC(source: string, filename: string): SFCDescriptor {
  const { descriptor, errors } = sfcParse(source, { filename });
  if (errors.length > 0) {
    throw new Error(`Failed to parse ${filename}:\n${errors.map((e) => e.message).join("\n")}`);
  }
  return descriptor;
}

export function parseTemplate(template: string): RootNode {
  return baseParse(template);
}
