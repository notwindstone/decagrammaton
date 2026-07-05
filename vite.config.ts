import { defineConfig } from "vite";
import { malkuth } from "./src/compiler/vite-plugin-deca.ts";

export default defineConfig({
  build: {
    modulePreload: false,
  },
  plugins: [malkuth()],
});
