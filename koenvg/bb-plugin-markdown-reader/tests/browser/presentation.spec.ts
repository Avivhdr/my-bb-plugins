import { test, expect, raster, capture, results, focusProof } from "./fixture";
import { geometry as measureGeometry, contrast as measureContrast } from "./presentation-measures";

const png = raster(1200, 600, [100, 130, 150]);
const cases = [
  ...[390, 760, 1440].flatMap((width) =>
    ["light", "dark"].map((theme) => ({
      width,
      theme,
      viewport: width,
      name: `${width}-${theme}`,
    })),
  ),
  { width: 760, theme: "custom", viewport: 760, name: "760-custom" },
  { width: 390, theme: "light", viewport: 1440, name: "narrow-in-wide" },
];
const assertContrast = (contrast: ReturnType<typeof measureContrast>) => {
  expect(contrast.body.ratio).toBeGreaterThanOrEqual(4.5);
  expect(contrast.tokenMin).toBeGreaterThanOrEqual(4.5);
};

for (const { width, theme, viewport, name } of cases) {
  test(`presentation ${name}`, async ({ page }, info) => {
    await page.setViewportSize({ width: viewport, height: 1000 });
    const evidence = {
      pageErrors: [] as string[],
      consoleErrors: [] as string[],
      failedRequests: [] as string[],
      responseCounts: {} as Record<string, number>,
    };
    page.on("pageerror", (error) => {
      if (evidence.pageErrors.length < 20) evidence.pageErrors.push(String(error).slice(0, 300));
    });
    page.on("console", (msg) => {
      if (msg.type() === "error" && evidence.consoleErrors.length < 20)
        evidence.consoleErrors.push(msg.text().slice(0, 300));
    });
    page.on("requestfailed", (request) => {
      if (evidence.failedRequests.length < 20)
        evidence.failedRequests.push(new URL(request.url()).pathname);
    });
    page.on("response", (response) => {
      const key = String(response.status());
      evidence.responseCounts[key] = (evidence.responseCounts[key] ?? 0) + 1;
    });
    await page.route("https://fixture.invalid/diagram.png", (route) =>
      route.fulfill({ status: 200, contentType: "image/png", body: png }),
    );
    try {
      const sentinel = name === "narrow-in-wide" ? "&sentinel=1" : "";
      await page.goto(`/tests/presentation-preview.html?width=${width}&theme=${theme}${sentinel}`);
      const reader = page.getByRole("region", { name: "Markdown Reader", exact: true });
      await page.getByRole("heading", { level: 1 }).waitFor();
      await page.waitForFunction("document.querySelector('.mr-prose img')?.naturalWidth === 1200");
      const outlineMode = width > 1080 ? "aside" : "inline";
      await page.waitForFunction(
        "document.querySelector('.mr-document-layout').dataset.outline === " +
          JSON.stringify(outlineMode),
      );
      const geometry = await reader.evaluate(measureGeometry);
      expect(geometry.width).toBe(width);
      expect(geometry.scrollWidth).toBe(width);
      expect(geometry.documentWidth).toBe(viewport);
      expect(geometry.proseWidth).toBe(
        Math.min(720, width - (width <= 600 ? 48 : width <= 1080 ? 80 : 96)),
      );
      expect(Math.abs(geometry.leftSpace - geometry.rightSpace)).toBeLessThan(1);
      expect(geometry.proseFont).toBe(width === 390 ? "15px" : "16px");
      expect(geometry.lineHeight).toBe(width === 390 ? "27px" : "28px");
      expect(parseFloat(geometry.sectionAbove)).toBeGreaterThan(parseFloat(geometry.sectionBelow));
      expect(geometry.pathTruncated).toBe(true);
      expect(geometry.buttons.every((b) => b.inside && b.height === 28)).toBe(true);
      expect(geometry.buttons).toHaveLength(4);
      expect(geometry.code.at(-1)!.scrollWidth).toBeGreaterThan(geometry.code.at(-1)!.width);
      expect(geometry.tables.at(-1)!.scrollWidth).toBeGreaterThan(geometry.tables.at(-1)!.width);
      expect(geometry.image.width).toBeLessThanOrEqual(geometry.proseWidth);
      expect(Math.abs(geometry.image.width / geometry.image.height - 2)).toBeLessThan(0.01);
      const headingCounts = await Promise.all(
        [1, 2, 3, 4, 5, 6].map((level) => reader.getByRole("heading", { level }).count()),
      );
      expect(headingCounts).toEqual([1, 5, 2, 1, 1, 1]); // Includes the accessible footnote label.
      await expect(page.getByRole("columnheader", { name: "Observation" })).toHaveCount(1);
      expect(await page.locator(".mr-prose pre").first().textContent()).toBe(
        '{"compact":true,"value":"<script>not active</script>"}\n',
      );
      expect(await page.locator(".mr-prose pre").nth(1).textContent()).toBe(
        '{\n  "query": "workspace Markdown",\n  "locationQuery": "",\n  "constraints": ["read-only", "explicit host"]\n}\n',
      );
      await expect(page.locator(".mr-prose script, .mr-prose iframe")).toHaveCount(0);
      const contrast = await page.evaluate(measureContrast);
      assertContrast(contrast);
      if (theme === "custom") {
        expect(contrast.body.foreground.slice(0, 3)).toEqual([48, 51, 78]);
        expect(contrast.body.background.slice(0, 3)).toEqual([255, 248, 239]);
        expect(contrast.radius).toBe("12px");
      }
      const captures = [];
      for (const suffix of ["top", "code"]) {
        if (suffix === "code") await page.locator(".mr-prose pre").first().scrollIntoViewIfNeeded();
        captures.push(await capture(page, info, `${name}-${suffix}`));
      }
      await reader.evaluate((e) => {
        e.scrollTop = 0;
      });
      await page.evaluate(
        "window.savedReader=document.querySelector('.markdown-reader');window.savedHeading=document.querySelector('.mr-prose h1')",
      );
      const previewText = await page.locator(".mr-prose").textContent();
      const liveContrasts = [];
      for (const changedTheme of ["dark", "light", "custom", theme]) {
        await page.evaluate((t) => {
          document.documentElement.dataset.theme = t;
        }, changedTheme);
        expect(
          await page.evaluate(
            "savedReader===document.querySelector('.markdown-reader') && savedHeading===document.querySelector('.mr-prose h1')",
          ),
        ).toBe(true);
        expect(await page.locator(".mr-prose").textContent()).toBe(previewText);
        await expect(page.getByRole("button", { name: "Preview", exact: true })).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        await expect(page.getByRole("button", { name: "Outline", exact: true })).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        const measured = await page.evaluate(measureContrast);
        assertContrast(measured);
        liveContrasts.push({
          theme: changedTheme,
          body: measured.body,
          tokenMin: measured.tokenMin,
        });
      }
      const preview = page.getByRole("button", { name: "Preview", exact: true });
      const rawButton = page.getByRole("button", { name: "Raw", exact: true });
      const outline = page.getByRole("button", { name: "Outline", exact: true });
      await preview.focus();
      const focus = [await focusProof(preview)];
      await page.keyboard.press("Tab");
      focus.push(await focusProof(rawButton));
      await page.keyboard.press("Space");
      const raw = page.getByLabel("Raw Markdown", { exact: true });
      expect(await raw.textContent()).toBe(await page.evaluate("presentationFixture.text"));
      await page.evaluate("window.savedRaw=document.querySelector('.mr-raw')");
      await page.keyboard.press("Tab");
      focus.push(await focusProof(page.getByRole("button", { name: "Refresh", exact: true })));
      await expect(
        page.getByRole("button", { name: "Open in BB preview", exact: true }),
      ).toHaveCount(0);
      await page.evaluate(
        "document.documentElement.dataset.theme='custom';presentationFixture.panel.style.width='390px'",
      );
      expect(await raw.textContent()).toBe(await page.evaluate("presentationFixture.text"));
      await expect(rawButton).toHaveAttribute("aria-pressed", "true");
      for (const changedTheme of ["dark", "light", "custom"]) {
        await page.evaluate((t) => {
          document.documentElement.dataset.theme = t;
        }, changedTheme);
        expect(await raw.textContent()).toBe(await page.evaluate("presentationFixture.text"));
        await expect(rawButton).toHaveAttribute("aria-pressed", "true");
        expect(
          await page.evaluate(
            "savedRaw===document.querySelector('.mr-raw') && savedReader===document.querySelector('.markdown-reader')",
          ),
        ).toBe(true);
      }
      await rawButton.focus();
      focus.push(await focusProof(rawButton));
      await page.keyboard.press("Shift+Tab");
      focus.push(await focusProof(preview));
      await page.keyboard.press("Enter");
      await page.keyboard.press("Tab");
      focus.push(await focusProof(rawButton));
      await page.keyboard.press("Tab");
      focus.push(await focusProof(outline));
      await page.keyboard.press("Space");
      await expect(page.locator(".mr-document-layout")).toHaveAttribute("data-outline", "hidden");
      await expect(outline).toHaveAttribute("aria-pressed", "false");
      await page.evaluate(
        `document.documentElement.dataset.theme='${theme}';presentationFixture.panel.style.width='${width}px'`,
      );
      await expect(outline).toHaveAttribute("aria-pressed", "false");
      expect(await page.evaluate("savedReader===document.querySelector('.markdown-reader')")).toBe(
        true,
      );
      await page.keyboard.press("Enter");
      await page.waitForFunction(
        "document.querySelector('.mr-document-layout').dataset.outline === " +
          JSON.stringify(outlineMode),
      );
      if (width <= 1080) {
        const summary = page.locator(".mr-outline-inline summary");
        await summary.focus();
        focus.push(await focusProof(summary));
        await page.keyboard.press("Enter");
        expect(await page.locator(".mr-outline-inline").getAttribute("open")).not.toBeNull();
        await page.evaluate("document.documentElement.dataset.theme='custom'");
        expect(await page.locator(".mr-outline-inline").getAttribute("open")).not.toBeNull();
      }
      const finalEntry = page
        .getByRole("navigation", { name: "Document sections" })
        .getByRole("link", { name: "Final section", exact: true });
      await finalEntry.focus();
      await page.keyboard.press("Enter");
      const heading = page.getByRole("heading", { name: "Final section", exact: true });
      expect(await heading.evaluate((e) => document.activeElement === e)).toBe(true);
      const hr = await heading.boundingBox(),
        toolbar = await page.locator(".mr-toolbar").boundingBox();
      expect(hr).not.toBeNull();
      expect(toolbar).not.toBeNull();
      expect(hr!.y).toBeGreaterThanOrEqual(toolbar!.y + toolbar!.height - 2);
      expect(hr!.y).toBeLessThan(1000);
      await page.getByRole("link", { name: "Go to the final section", exact: true }).focus();
      await page.keyboard.press("Enter");
      expect(await heading.evaluate((e) => document.activeElement === e)).toBe(true);
      await page.locator(".mr-prose sup a").first().focus();
      await page.keyboard.press("Enter");
      expect(
        await page.evaluate("document.activeElement.closest('.markdown-reader') === savedReader"),
      ).toBe(true);
      await page.locator('.mr-prose a[aria-label="Back to reference 1"]').first().focus();
      await page.keyboard.press("Enter");
      expect(await page.evaluate("document.activeElement.closest('sup') !== null")).toBe(true);
      for (const region of [
        page.locator(".mr-prose pre").last(),
        page.locator(".mr-table-scroll").last(),
      ]) {
        await region.focus();
        focus.push(await focusProof(region));
        await page.keyboard.press("ArrowRight");
        await page.waitForFunction("e => e.scrollLeft > 0", await region.elementHandle());
      }
      expect(await reader.evaluate((e) => e.clientWidth === e.scrollWidth)).toBe(true);
      expect(
        await page.evaluate(
          "presentationFixture.inspection.rpcCalls.filter(c=>c.method==='read_document').length",
        ),
      ).toBe(1);
      expect(await page.evaluate("presentationFixture.inspection.navigateCalls.length")).toBe(0);
      const sentinelStyles = await page.locator(".fixture-sentinel").evaluate((e) => ({
        heading: getComputedStyle(e.querySelector("h2")!).fontSize,
        paragraphMargin: getComputedStyle(e.querySelector("p")!).marginTop,
        buttonOutline: getComputedStyle(e.querySelector("button")!).outlineStyle,
      }));
      expect(sentinelStyles).toEqual({
        heading: "13px",
        paragraphMargin: "0px",
        buttonOutline: "none",
      });
      expect(evidence.pageErrors).toEqual([]);
      expect(evidence.consoleErrors).toEqual([]);
      expect(evidence.failedRequests).toEqual([]);
      await results(info, {
        case: name,
        geometry,
        contrast,
        liveContrasts,
        focus,
        rawExact: true,
        liveThemeAndWidthState: true,
        localNavigation: true,
        keyboardLocalScroll: true,
        sentinelStyles,
        captures,
        browser: evidence,
      });
    } finally {
      await info.attach("browser-diagnostics", {
        body: JSON.stringify(evidence, null, 2),
        contentType: "application/json",
      });
    }
  });
}

test("presentation heading-free", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/tests/presentation-preview.html?width=390&headings=none&theme=dark&sentinel=1");
  await page.getByText("Plain text without headings.").waitFor();
  await expect(page.getByRole("button", { name: "Outline", exact: true })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Document sections" })).toHaveCount(0);
  expect(
    await page
      .locator(".markdown-reader")
      .evaluate((e) => e.clientWidth === 390 && e.scrollWidth === 390),
  ).toBe(true);
  await page.getByRole("button", { name: "Raw", exact: true }).focus();
  await page.keyboard.press("Enter");
  expect(await page.getByLabel("Raw Markdown", { exact: true }).textContent()).toBe(
    await page.evaluate("presentationFixture.text"),
  );
  await results(info, { case: "heading-free", noOutline: true, rawExact: true });
});
