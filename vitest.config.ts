import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    conditions: ["browser"],
    dedupe: ["svelte"],
    alias: {
      "@gizmo/unity/server": `${root}packages/unity/src/server/index.ts`,
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
  },
});
