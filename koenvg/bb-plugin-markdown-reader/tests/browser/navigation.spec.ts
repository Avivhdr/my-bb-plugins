import { test, expect, sourceText, revealed, capture, results } from "./fixture";
import type { Page } from "@playwright/test";

const request = (page: Page, start: number, end: number) =>
  page.evaluate(
    (range) => window.dispatchEvent(new CustomEvent("fixture-line-request", { detail: { range } })),
    { startLineNumber: start, endLineNumber: end },
  );

for (const [width, theme] of [
  [1440, "light"],
  [760, "light"],
  [390, "dark"],
] as const) {
  test(`navigation ${width}-${theme}`, async ({ page, pageErrors }, info) => {
    const source = await sourceText("navigation");
    await page.setViewportSize({ width: 1440, height: 850 });
    await page.goto(`/?document=navigation&width=${width}&theme=${theme}`);
    const panel = page.locator(".markdown-reader");
    await page.getByRole("article").waitFor();
    const outline =
      width > 1080
        ? page.getByRole("complementary", { name: "On this page" })
        : page.locator("details");
    if (width > 1080) {
      await outline.waitFor();
      expect(await outline.evaluate((e) => e.getBoundingClientRect().width)).toBe(164);
      expect(
        await page
          .locator(".mr-document-layout")
          .evaluate((e) => ({ width: e.clientWidth, gap: getComputedStyle(e).columnGap })),
      ).toEqual({ width: 944, gap: "60px" });
    } else {
      expect(await outline.evaluate((e) => (e as HTMLDetailsElement).open)).toBe(false);
      const summary = outline.locator("summary");
      await summary.focus();
      await page.keyboard.press("Enter");
      expect(await outline.evaluate((e) => (e as HTMLDetailsElement).open)).toBe(true);
      expect(
        await summary.evaluate(
          (e) => e.matches(":focus-visible") && getComputedStyle(e).outlineWidth === "2px",
        ),
      ).toBe(true);
    }
    const screenshots = [await capture(page, info, `outline-${width}-${theme}`)];
    await outline.getByRole("link", { name: "日本語 code link", exact: true }).nth(1).focus();
    await page.keyboard.press("Enter");
    const target = panel.getByRole("heading", { name: "日本語 code link", exact: true }).nth(1);
    expect(await target.evaluate((e) => e === document.activeElement)).toBe(true);
    expect(await revealed(target)).toBe(true);
    expect(await panel.evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
    await expect(page.getByRole("button", { name: "Outline", exact: true })).toBeVisible();
    expect(await page.evaluate("location.hash")).toBe("");
    await panel.evaluate((e) => {
      e.scrollTop = 0;
    });
    const oldId = await target.getAttribute("id");
    const link = panel.getByRole("link", { name: "Second Japanese heading" });
    await link.focus();
    await page.keyboard.press("Enter");
    expect(await target.evaluate((e) => e === document.activeElement)).toBe(true);
    expect(await revealed(target)).toBe(true);
    await panel.evaluate((e) => {
      e.scrollTop = 0;
    });
    await link.click({ modifiers: ["Control"] });
    await panel.evaluate((e) => {
      e.scrollTop = 0;
    });
    await link.click({ button: "middle" });
    expect(page.context().pages()).toHaveLength(1);
    expect(await page.evaluate("location.hash")).toBe("");
    await expect(panel.locator("img")).toHaveCount(0);
    await expect(panel.getByRole("link", { name: "File stays inert" })).toHaveCount(0);
    await panel.evaluate((e) => {
      e.scrollTop = 0;
    });
    const beforeTop = await panel
      .locator(".mr-prose")
      .evaluate((e) => e.getBoundingClientRect().top);
    await page.getByRole("button", { name: "Outline", exact: true }).click();
    await expect(panel.locator("aside, details")).toHaveCount(0);
    expect(
      await panel.locator(".mr-document-layout").evaluate((e) => e.clientWidth),
    ).toBeLessThanOrEqual(720);
    if (width <= 1080)
      expect(
        await panel.locator(".mr-prose").evaluate((e) => e.getBoundingClientRect().top),
      ).toBeLessThan(beforeTop);
    expect(await target.getAttribute("id")).toBe(oldId);
    await request(page, 18, 18);
    const raw = page.getByLabel("Raw Markdown", { exact: true });
    await raw.waitFor();
    expect(await raw.textContent()).toBe(source);
    const line = raw.locator('[data-source-line="18"]');
    await expect(raw.locator('[data-highlighted="true"]')).toHaveCount(1);
    expect(await line.textContent()).toBe(source.match(/[^\n]*\n|[^\n]+$/g)![17]);
    expect(await line.evaluate((e) => e === document.activeElement)).toBe(true);
    expect(await revealed(line)).toBe(true);
    if (width === 390)
      expect(
        await line.evaluate((e) => e.clientHeight > 3 * parseFloat(getComputedStyle(e).lineHeight)),
      ).toBe(true);
    expect(await raw.evaluate((e) => e.scrollWidth === e.clientWidth)).toBe(true);
    screenshots.push(await capture(page, info, `raw-target-${width}-${theme}`));
    await page.evaluate("window.fixtureRawIdentity = document.querySelector('.mr-raw')");
    await panel.evaluate((e) => {
      e.scrollTop = 0;
    });
    await page.getByRole("button", { name: "Raw", exact: true }).focus();
    await request(page, 18, 18);
    await page.waitForFunction(
      "document.activeElement?.dataset.sourceLine === '18' && document.querySelector('.markdown-reader').scrollTop > 0",
    );
    expect(
      await page.evaluate("document.querySelector('.mr-raw') === window.fixtureRawIdentity"),
    ).toBe(true);
    expect(await revealed(line)).toBe(true);
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    expect(await target.getAttribute("id")).toBe(oldId);
    await request(page, 1000, 54);
    await raw.waitFor();
    await expect(raw.locator('[data-highlighted="true"]')).toHaveCount(3);
    expect(await raw.textContent()).toBe(source);
    expect(await page.evaluate("document.documentElement.dataset.fixtureReads")).toBe("1");
    expect(await panel.evaluate((e) => e.scrollWidth === e.clientWidth)).toBe(true);
    await results(info, {
      width,
      theme,
      outline: true,
      localFocus: true,
      reclaimedSpace: true,
      fragmentNoReopen: true,
      exactCRLFRaw: true,
      repeatedReveal: true,
      clampedRange: true,
      noReload: true,
      errors: pageErrors,
      screenshots,
    });
  });
}

test("dynamic panel resize", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 850 });
  await page.goto("/?document=navigation&width=1440");
  await page.locator(".mr-outline-aside").waitFor();
  await page.locator(".fixture-panel").evaluate((e) => {
    (e as HTMLElement).style.width = "760px";
  });
  await page.locator("details").waitFor();
  expect(await page.locator("details").evaluate((e) => (e as HTMLDetailsElement).open)).toBe(false);
  await expect(page.locator(".mr-outline-aside")).toHaveCount(0);
  await results(info, { dynamicPanelResize: true, desktopViewport: 1440, readerWidth: 760 });
});

test("no empty outline", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 850 });
  await page.goto("/?document=no-headings&width=1440");
  await page.getByRole("article").waitFor();
  await expect(page.getByRole("button", { name: "Outline", exact: true })).toHaveCount(0);
  await expect(page.locator("details, .mr-outline-aside")).toHaveCount(0);
  await results(info, { noEmptyOutline: true });
});

test("independent readers have unique local targets", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 850 });
  await page.goto("/?document=navigation&width=1440&readers=2");
  await page.getByRole("article").nth(1).waitFor();
  const readers = page.locator(".markdown-reader");
  const ids = await page.locator(".mr-prose [id]").evaluateAll((es) => es.map((e) => e.id));
  expect(ids.length).toBe(new Set(ids).size);
  await readers.nth(1).getByRole("link", { name: "Second Japanese heading" }).click();
  const second = readers
    .nth(1)
    .getByRole("heading", { name: "日本語 code link", exact: true })
    .nth(1);
  expect(await second.evaluate((e) => e === document.activeElement)).toBe(true);
  expect(await revealed(second)).toBe(true);
  expect(await readers.nth(0).evaluate((e) => e.scrollTop)).toBe(0);
  expect(await readers.nth(1).evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
  const screenshot = await capture(page, info, "independent-readers");
  await results(info, {
    independentReaders: true,
    uniqueIds: true,
    localScrollOnly: true,
    screenshot,
  });
});

test("initial line request", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 850 });
  await page.goto("/?document=navigation&width=760&start=18&end=18");
  const raw = page.getByLabel("Raw Markdown", { exact: true });
  await raw.waitFor();
  expect(await raw.textContent()).toBe(await sourceText("navigation"));
  await page.waitForFunction("document.activeElement?.dataset.sourceLine === '18'");
  await results(info, { initialLineRequest: true });
});

for (const headings of ["none", "actual"]) {
  test(`footnotes ${headings}`, async ({ page, pageErrors }, info) => {
    await page.setViewportSize({ width: 1100, height: 850 });
    await page.goto(`/?document=footnotes&headings=${headings}&width=760&start=1&end=1`);
    const raw = page.getByLabel("Raw Markdown", { exact: true });
    await raw.waitFor();
    const expected =
      (headings === "none" ? "" : "# Actual\r\n\r\n") +
      "Text[^1] and repeated[^1]\r\n\r\n[^1]: Note é.\r\n";
    expect(await raw.textContent()).toBe(expected);
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(page.getByRole("article")).toContainText("Note é.");
    await expect(page.getByRole("button", { name: "Outline", exact: true })).toHaveCount(
      headings === "none" ? 0 : 1,
    );
    await expect(page.locator(".mr-prose a[href]")).toHaveCount(4);
    expect(
      await page
        .locator(".mr-prose a[href]")
        .evaluateAll((es) =>
          es.every((e) =>
            Array.from(e.closest(".mr-prose")!.querySelectorAll("[id]")).some(
              (t) => "#" + t.id === e.getAttribute("href"),
            ),
          ),
        ),
    ).toBe(true);
    expect(
      await page
        .locator("[data-footnotes] > .sr-only")
        .evaluate((e) => e.getBoundingClientRect().width),
    ).toBe(1);
    const referencesLocal = await page
      .locator(".mr-prose sup [aria-describedby]")
      .evaluateAll((es) =>
        es.every((e) =>
          Array.from(e.closest(".mr-prose")!.querySelectorAll("[id]")).some(
            (label) =>
              label.id === e.getAttribute("aria-describedby") && label.textContent === "Footnotes",
          ),
        ),
      );
    expect(referencesLocal).toBe(true);
    const screenshot = await capture(page, info, `footnotes-${headings}`);
    await results(info, {
      footnotes: headings,
      initialExactRaw: true,
      noInventedOutline: true,
      readerLocalFragments: true,
      localAccessibilityReferences: true,
      errors: pageErrors,
      screenshot,
    });
  });
}
