import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // BB shares these runtimes across plugin bundles; cross-plugin tests must too.
    dedupe: ["react", "react-dom", "@get-bb/plugin-sdk", "@pierre/diffs", "@testing-library/react"],
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  server: { fs: { allow: [".."] } },
  test: {
    include: ["**/*.test.{ts,tsx}", "../review-ui/**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", "dist/**"],
  },
});
