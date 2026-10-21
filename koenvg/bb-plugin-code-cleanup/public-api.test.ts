import { describe, expect, it } from "vitest";
import { experimental_scanPublicSdkOnly } from "@get-bb/plugin-sdk/testing";
import { fileURLToPath } from "node:url";

describe("public SDK boundary", () => {
  it("imports no private BB packages or files outside this plugin", () => {
    const scan = experimental_scanPublicSdkOnly(fileURLToPath(new URL(".", import.meta.url)), {
      allow: [
        /^vitest$/,
        /^react$/,
        /^react-markdown$/,
        /^@hugeicons\/(react|core-free-icons\/[A-Za-z0-9]+Icon)$/,
        /^react-dom\/client$/,
        /^@testing-library\/(react|user-event)$/,
        /^vite$/,
        /^@get-bb\/plugin-sdk\/testing$/,
      ],
    });
    expect(scan.files).toContain("server.ts");
    expect(scan.files).toContain("app.tsx");
    expect(scan.files).toContain("preview/server.ts");
    expect(scan.violations).toEqual([]);
    expect(scan.privateDependencies).toEqual([]);
  });
});
