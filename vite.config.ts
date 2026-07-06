import path from "node:path";

import { defineConfig } from "vite";
import { malkuth } from "./src/compiler/vite-plugin-deca.ts";

export default defineConfig({
  build: {
    modulePreload: false,
  },
  "resolve": {
    "alias": {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  plugins: [malkuth()],
});
