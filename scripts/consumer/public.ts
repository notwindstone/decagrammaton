import { createApp, type ComponentModule } from "decagrammaton";
import { compile } from "decagrammaton/compiler";
import { malkuth } from "decagrammaton/vite";
import { type Block } from "decagrammaton/runtime";
import { createSafeDocument } from "ark-of-atrahasis";
import { FACTORY_TAGS } from "ark-of-atrahasis/validators";
import { getRealNode } from "ark-of-atrahasis/host";

export function mount(root: HTMLElement, app: ComponentModule) {
  return createApp(app).mount(createSafeDocument(root));
}
export type Rendered = Block;
export { compile, malkuth, FACTORY_TAGS, getRealNode };
