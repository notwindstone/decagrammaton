import { defineConfig } from "vite";
import { malkuth } from "decagrammaton/vite";
export default defineConfig({
  plugins: [malkuth()],
  build: {
    lib: { entry: "entry.ts", name: "fixture", formats: ["iife"], fileName: () => "fixture.js" },
  },
});
