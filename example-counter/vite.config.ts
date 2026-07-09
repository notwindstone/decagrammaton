import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { malkuth } from "../src/vite.ts";

export default defineConfig({
  plugins: [malkuth()],
  resolve: {
    alias: [
      {
        find: /^decagrammaton$/,
        replacement: fileURLToPath(new URL("../src/index.ts", import.meta.url)),
      },
      {
        find: /^decagrammaton\/runtime$/,
        replacement: fileURLToPath(new URL("../src/runtime/index.ts", import.meta.url)),
      },
    ],
  },
  build: {
    modulePreload: false,
    rollupOptions: {
      external: ["ark-of-atrahasis"],
      output: {
        globals: {
          vue: "window.ark",
        },
      },
    },
  },
});
