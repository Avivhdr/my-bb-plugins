import { defineConfig } from "@playwright/test";
import { browserFixtureOrigin } from "../scripts/browser-fixture-runner.mjs";

// Synthetic local SDK fixtures, not installed BB acceptance.
export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 2,
  timeout: 30_000,
  outputDir: "test-results",
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/results.json" }],
    ["html", { open: "never" }],
  ],
  use: {
    baseURL: browserFixtureOrigin(),
    browserName: "chromium",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    serviceWorkers: "block",
  },
});
