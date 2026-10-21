import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: { dedupe: ["react", "react-dom"] },
  test: { environment: "jsdom", include: ["tests/**/*.test.{ts,tsx}"], clearMocks: true },
});
