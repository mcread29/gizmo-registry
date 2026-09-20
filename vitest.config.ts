import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@gizmo/unity/server": `${root}packages/unity/src/server/index.ts`,
    },
  },
  test: {
    maxWorkers: 1,
    environment: "node",
    exclude: [...configDefaults.exclude, "extensions/*/skills/**", "local/**"],
  },
});
