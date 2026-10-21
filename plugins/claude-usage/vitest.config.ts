import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": new URL("./", import.meta.url).pathname } },
  test: {
    environment: "node",
    env: { TZ: "Europe/Brussels" },
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
