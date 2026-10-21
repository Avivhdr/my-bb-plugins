import { test as base, expect, type Locator, type TestInfo } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { crc32, deflateSync } from "node:zlib";

// All browser contexts are fresh and owned by Playwright. Unexpected traffic is
// blocked, then fails the test. Suite-specific page routes supply synthetic images.
export const test = base.extend<{ localTraffic: void; pageErrors: string[] }>({
  localTraffic: [
    async ({ context, baseURL }, use) => {
      const blocked: string[] = [];
      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.origin === new URL(baseURL!).origin) await route.continue();
        else {
          blocked.push(url.href);
          await route.abort("blockedbyclient");
        }
      });
      await use();
      expect(blocked, "No real remote traffic is allowed").toEqual([]);
    },
    { auto: true },
  ],
  pageErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      await use(errors);
      expect(errors, "Browser runtime errors").toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

export const sourceText = (name: string) =>
  readFile(new URL(`../fixtures/${name}.md`, import.meta.url), "utf8");

export async function results(info: TestInfo, value: object) {
  await info.attach("results", {
    body: JSON.stringify({ fixtureOnly: true, ...value }, null, 2) + "\n",
    contentType: "application/json",
  });
}

export async function capture(page: import("@playwright/test").Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  const bytes = await page.screenshot({ path });
  await info.attach(name, { path, contentType: "image/png" });
  return { path: `${name}.png`, sha256: createHash("sha256").update(bytes).digest("hex") };
}

export function raster(width: number, height: number, color: number[]) {
  const chunk = (kind: string, data: Buffer) => {
    const typeAndData = Buffer.concat([Buffer.from(kind), data]);
    const size = Buffer.alloc(4),
      checksum = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    checksum.writeUInt32BE(crc32(typeAndData));
    return Buffer.concat([size, typeAndData, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set(color, 1 + x * 3);
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export async function focusProof(locator: Locator) {
  const value = await locator.evaluate((e) => {
    const s = getComputedStyle(e),
      r = e.getBoundingClientRect();
    return {
      active: document.activeElement === e,
      visible: e.matches(":focus-visible"),
      outline: s.outlineStyle,
      width: s.outlineWidth,
      color: s.outlineColor,
      onScreen: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth,
    };
  });
  expect(value).toMatchObject({
    active: true,
    visible: true,
    outline: "solid",
    width: "2px",
    onScreen: true,
  });
  return value;
}

export const revealed = (target: Locator) =>
  target.evaluate((e) => {
    const panel = e.closest(".markdown-reader")!,
      r = e.getBoundingClientRect();
    const toolbar = panel.querySelector(".mr-toolbar")!.getBoundingClientRect();
    return r.top >= toolbar.bottom && r.top < panel.getBoundingClientRect().bottom;
  });
