import { defineConfig } from "vite";
import { malkuth } from "../src/vite";
import unocss from "unocss/vite";

export default defineConfig({
  plugins: [malkuth(), unocss()],
});
