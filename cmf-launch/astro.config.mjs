// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

// Static output; deployable to Vercel or Netlify with zero config
// (point the project root at the cmf-launch/ directory).
export default defineConfig({
  output: "static",
  vite: {
    plugins: [tailwindcss()],
  },
});
