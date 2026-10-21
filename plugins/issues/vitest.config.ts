import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // BB shares these runtimes across plugin bundles; tests must too.
    dedupe: ["react", "react-dom", "@get-bb/plugin-sdk"],
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
});
