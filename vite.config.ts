import { defineConfig } from "vite";
import { decaPlugin } from "./src/compiler/vite-plugin-deca.ts";

export default defineConfig({
  build: {
    modulePreload: false,
  },
  plugins: [decaPlugin()],
});
