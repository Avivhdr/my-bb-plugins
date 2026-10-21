import { defineConfig } from "@playwright/test";
import { browserFixtureOrigin } from "../scripts/browser-fixture-runner.mjs";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/*.spec.ts",
  forbidOnly: true,
  retries: 0,
  timeout: 30_000,
  outputDir: "test-results",
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["json", { outputFile: "test-results/results.json" }],
  ],
  use: {
    baseURL: browserFixtureOrigin(),
    browserName: "chromium",
    deviceScaleFactor: 1,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
