import { defineConfig } from "vite";
import { malkuth } from "../src/vite";

export default defineConfig({
  plugins: [malkuth()],
});
