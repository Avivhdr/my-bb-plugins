import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { experimental_scanPublicSdkOnly } from "@get-bb/plugin-sdk/testing";

it("uses public SDK contracts and declared public dependencies only", () => {
  const scan = experimental_scanPublicSdkOnly(fileURLToPath(new URL("..", import.meta.url)), {
    allow: [
      /^@modelcontextprotocol\/sdk\//,
      /^jose$/,
      /^vitest$/,
      /^@get-bb\/plugin-sdk\/testing$/,
    ],
  });
  expect(scan.violations).toEqual([]);
  expect(scan.privateDependencies).toEqual([]);
});
