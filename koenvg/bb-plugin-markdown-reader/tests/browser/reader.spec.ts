import { test, expect, sourceText, capture, results } from "./fixture";

for (const [width, theme] of [
  [760, "light"],
  [390, "dark"],
  [1440, "custom"],
] as const) {
  test(`reader ${width}-${theme}`, async ({ page, pageErrors }, info) => {
    const source = await sourceText("report");
    await page.setViewportSize({ width: Math.max(width, 1100), height: 1000 });
    await page.goto(`/?width=${width}&theme=${theme}`);
    await page.getByRole("heading", { name: "Reading a workspace document" }).waitFor();
    const geometry = await page.locator(".markdown-reader").evaluate((e) => {
      const prose = e.querySelector<HTMLElement>(".mr-prose")!;
      const ps = getComputedStyle(prose),
        toolbar = e.querySelector<HTMLElement>(".mr-toolbar")!;
      return {
        width: e.clientWidth,
        scrollWidth: e.scrollWidth,
        proseWidth: prose.clientWidth,
        fontSize: ps.fontSize,
        lineHeight: ps.lineHeight,
        contentPadding: getComputedStyle(e.querySelector(".mr-content")!).padding,
        toolbarHeight: toolbar.clientHeight,
        buttonsInside: Array.from(toolbar.querySelectorAll("button")).every((b) => {
          const r = b.getBoundingClientRect(),
            t = toolbar.getBoundingClientRect();
          return r.left >= t.left && r.right <= t.right && r.top >= t.top && r.bottom <= t.bottom;
        }),
      };
    });
    expect(geometry.width).toBe(width);
    expect(geometry.scrollWidth).toBe(width);
    expect(geometry.proseWidth).toBeLessThanOrEqual(720);
    expect(geometry.buttonsInside).toBe(true);
    expect(geometry.fontSize).toBe(width === 390 ? "15px" : "16px");
    await expect(page.locator(".mr-prose a[href], .mr-prose img")).toHaveCount(0);
    expect(
      await page
        .locator(".mr-prose pre")
        .last()
        .evaluate((e) => e.scrollWidth > e.clientWidth),
    ).toBe(true);
    if (width === 390)
      expect(
        await page
          .locator(".mr-table-scroll")
          .last()
          .evaluate((e) => e.scrollWidth > e.clientWidth),
      ).toBe(true);
    const screenshot = await capture(page, info, `reader-${width}-${theme}`);
    await page.getByRole("button", { name: "Raw", exact: true }).focus();
    await page.keyboard.press("Enter");
    const raw = page.getByLabel("Raw Markdown", { exact: true });
    expect(await raw.textContent()).toBe(source);
    const beforeColor = await raw.evaluate((e) => getComputedStyle(e).color);
    await page.evaluate("document.documentElement.dataset.theme = 'custom'");
    expect(await raw.textContent()).toBe(source);
    const afterColor = await raw.evaluate((e) => getComputedStyle(e).color);
    if (theme !== "custom") expect(afterColor).not.toBe(beforeColor);
    expect(
      await page.locator(".fixture-outside h2").evaluate((e) => getComputedStyle(e).fontSize),
    ).toBe("13px");
    expect(
      await page.locator(".fixture-outside p").evaluate((e) => getComputedStyle(e).marginTop),
    ).toBe("0px");
    await page.getByRole("button", { name: "Preview", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Reading a workspace document" })).toBeVisible();
    expect(
      await page
        .getByRole("button", { name: "Preview", exact: true })
        .evaluate((e) => e.matches(":focus-visible")),
    ).toBe(true);
    await page.locator(".markdown-reader").evaluate((e) => {
      e.scrollTop = e.scrollHeight;
    });
    await expect(page.getByRole("button", { name: "Open in BB preview" })).toHaveCount(0);
    await results(info, {
      theme,
      geometry,
      browserErrors: pageErrors,
      rawExact: true,
      keyboard: true,
      readyOriginalAbsent: true,
      localOverflow: true,
      screenshot,
    });
  });
}
