import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { validateScreenshot } from "../browser-evidence.js";

interface CheckResult {
  theme: string;
  mode: string;
  viewport: number[];
  coarsePointer: boolean;
  reducedMotion: boolean;
  checks: number;
  passed: string[];
}

declare global {
  interface Window {
    fixture: {
      ready: boolean;
      originalInput: HTMLTextAreaElement;
      setSpeedEffect: (effect: string, motion?: boolean) => void;
      check: () => Promise<CheckResult>;
    };
  }
}

// Keep the complete Python matrix, including both split-send regression cases.
const cases = [
  {
    name: "hero-dark",
    width: 1504,
    height: 1046,
    theme: "dark",
    layout: "expanded",
    screenshot: "hero-repro.png",
  },
  {
    name: "desktop-dark",
    width: 1440,
    height: 1046,
    theme: "dark",
    layout: "expanded",
    screenshot: "desktop.png",
  },
  {
    name: "desktop-light",
    width: 1440,
    height: 1046,
    theme: "light",
    layout: "expanded",
    screenshot: "desktop-light.png",
  },
  {
    name: "user-width",
    width: 1615,
    height: 990,
    theme: "dark",
    layout: "expanded",
    screenshot: "user-1615.png",
  },
  {
    name: "mobile-dark",
    width: 390,
    height: 844,
    theme: "dark",
    layout: "expanded",
    touch: true,
    screenshot: "mobile.png",
  },
  {
    name: "mobile-light",
    width: 390,
    height: 844,
    theme: "light",
    layout: "expanded",
    touch: true,
    screenshot: "mobile-light.png",
  },
  { name: "custom-tokens", width: 1440, height: 1046, theme: "custom", layout: "expanded" },
  { name: "compact-dark", width: 1440, height: 1046, theme: "dark", layout: "compact" },
  { name: "compact-touch", width: 390, height: 844, theme: "dark", layout: "compact", touch: true },
  { name: "new-thread", width: 1440, height: 1046, theme: "light", layout: "new" },
  { name: "new-thread-touch", width: 390, height: 844, theme: "light", layout: "new", touch: true },
  {
    name: "disabled-action",
    width: 1440,
    height: 1046,
    theme: "dark",
    layout: "expanded",
    disabled: true,
  },
  {
    name: "reduced-motion",
    width: 390,
    height: 844,
    theme: "dark",
    layout: "expanded",
    touch: true,
    reduced: true,
  },
  {
    name: "long-draft",
    width: 390,
    height: 844,
    theme: "dark",
    layout: "expanded",
    touch: true,
    long: true,
  },
  {
    name: "split-send-empty",
    width: 1440,
    height: 1046,
    theme: "dark",
    layout: "expanded",
    touch: true,
    split: "empty",
  },
  {
    name: "split-send-draft",
    width: 1440,
    height: 1046,
    theme: "dark",
    layout: "expanded",
    touch: true,
    split: "draft",
  },
] satisfies Array<{
  name: string;
  width: number;
  height: number;
  theme: string;
  layout: string;
  touch?: boolean;
  reduced?: boolean;
  disabled?: boolean;
  long?: boolean;
  split?: string;
  screenshot?: string;
}>;

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

for (const entry of cases) {
  test.describe(entry.name, () => {
    test.use({
      viewport: { width: entry.width, height: entry.height },
      hasTouch: entry.touch ?? false,
      isMobile: entry.touch ?? false,
      reducedMotion: entry.reduced ? "reduce" : "no-preference",
    });

    test("native controls and scoped CSS", async ({ page, request }, testInfo) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const params = new URLSearchParams({ theme: entry.theme, layout: entry.layout });
      if (entry.disabled) params.set("disabled", "1");
      if (entry.long) params.set("long", "1");
      if (entry.split) params.set("split", entry.split);
      const response = await page.goto(`/tests/preview.html?${params}`);
      expect(response?.ok()).toBe(true);
      await expect(page).toHaveTitle("Compose Chat fixture");
      await page.waitForFunction(() => window.fixture?.ready);

      // All original DOM, CSS, contrast, submit, disable/re-enable and motion checks stay intact.
      const result = await page.evaluate(() => window.fixture.check());
      expect(result.theme).toBe(entry.theme);
      expect(result.mode).toBe(entry.layout);
      expect(result.viewport).toEqual([entry.width, entry.height]);
      expect(result.coarsePointer).toBe(entry.touch ?? false);
      expect(result.reducedMotion).toBe(entry.reduced ?? false);
      expect(result.checks).toBe(result.passed.length);
      expect(result.checks).toBeGreaterThan(0);

      // Use a real browser key event, not focus() on the expected next control.
      await page.locator('textarea[aria-label="Message"]').focus();
      await page.keyboard.press("Tab");
      const actions = page.getByRole("button", { name: "Prompt actions", exact: true });
      await expect(actions).toBeFocused();
      expect(await actions.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
      expect(
        await actions.evaluate((element) => parseFloat(getComputedStyle(element).outlineWidth)),
      ).toBeGreaterThanOrEqual(2);
      result.passed.push("actual Tab navigation preserves native order and visible focus");
      result.checks += 1;
      expect(errors).toEqual([]);

      await testInfo.attach("browser-checks", {
        body: JSON.stringify({ name: entry.name, ...result }, null, 2),
        contentType: "application/json",
      });

      if (entry.screenshot) {
        await page.evaluate(() => {
          scrollTo(0, 0);
          document.querySelector(".thread")!.scrollTop = 0;
          (document.activeElement as HTMLElement).blur();
        });
        // Match the old capture settling interval after blur and scroll.
        await page.waitForTimeout(200);
        const png = await page.screenshot({
          path: testInfo.outputPath(entry.screenshot),
          fullPage: false,
        });
        const scale = await page.evaluate(() => devicePixelRatio);
        const pixels = validateScreenshot(png, entry.width, entry.height, scale);
        await testInfo.attach(entry.screenshot, { body: png, contentType: "image/png" });

        const sources: Record<string, string> = {};
        for (const path of [
          "dist/app.js",
          "dist/app.css",
          "tests/preview.html",
          "tests/browser-checks.js",
          "tests/fixture-shine.svg",
        ]) {
          const asset = await request.get(`/${path}`);
          expect(asset.ok()).toBe(true);
          sources[path] = hash(await asset.body());
        }
        for (const path of [
          "tests/browser/matrix.spec.ts",
          "tests/browser-evidence.ts",
          "tests/preview-server.ts",
          "playwright.config.ts",
        ]) {
          sources[path] = hash(await readFile(new URL(`../../${path}`, import.meta.url)));
        }
        const provenance = testInfo.outputPath(`${entry.screenshot}.provenance.json`);
        await writeFile(
          provenance,
          JSON.stringify(
            {
              synthetic: true,
              case: entry.name,
              viewport: [entry.width, entry.height],
              capture: {
                file: entry.screenshot,
                method: "playwright-page",
                pixels,
                pixelScale: scale,
                sha256: hash(png),
              },
              sources,
            },
            null,
            2,
          ),
        );
        await testInfo.attach("screenshot-provenance", {
          path: provenance,
          contentType: "application/json",
        });
      }
    });
  });
}
