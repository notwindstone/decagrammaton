import { defineConfig } from "vite";
import { malkuth } from "decagrammaton/vite";

export default defineConfig({
  plugins: [malkuth()],
});
