import { test, expect, capture, results } from "./fixture";
import { RESET, measure } from "./ui-measures";

const cases = [
  ...[390, 760, 1440].flatMap((width) =>
    ["light", "dark"].map((theme) => ({
      width,
      theme,
      viewport: width,
      zoom: 1,
      name: `${width}-${theme}`,
    })),
  ),
  { width: 390, theme: "light", viewport: 1440, zoom: 1, name: "narrow-in-wide" },
  { width: 760, theme: "light", viewport: 760, zoom: 2, name: "zoom-200" },
  ...["light", "dark"].map((theme) => ({
    width: 390,
    theme,
    viewport: 390,
    zoom: 1,
    name: `390-${theme}-coarse`,
  })),
  { width: 320, theme: "custom", viewport: 320, zoom: 1, name: "320-custom-coarse" },
];
for (const { width, theme, viewport, zoom, name } of cases) {
  test.describe(`header ${name}`, () => {
    test.use({ hasTouch: name.endsWith("coarse") });
    test(`host reset lists and header ${name}`, async ({ page, pageErrors }, info) => {
      await page.setViewportSize({ width: viewport, height: 1000 });
      const path = "reports/" + "directory-segment/".repeat(8) + "actual-document-name.md";
      const query = new URLSearchParams({ width: String(width), theme, document: "lists", path });
      await page.goto(`/tests/presentation-preview.html?${query}`);
      const reader = page.getByRole("region", { name: "Markdown Reader", exact: true });
      await reader.getByRole("heading", { name: "Visible list markers" }).waitFor();
      await page.addStyleTag({ content: RESET });
      await page.evaluate(() => {
        const outside = document.createElement("ul");
        outside.id = "outside-list";
        outside.innerHTML = "<li>Outside marker sentinel</li>";
        outside.style.display = "none";
        document.body.append(outside);
      });
      if (zoom !== 1)
        await page.evaluate((z) => {
          document.documentElement.style.zoom = String(z);
        }, zoom);
      const measured = await reader.evaluate(measure);
      // Save the measurements even if an assertion fails.
      await results(info, { case: name, hostReset: RESET, zoom, computed: measured });
      for (const item of measured.lists) {
        const expected = item.tag === "OL" ? "decimal" : item.nested ? "circle" : "disc";
        expect(item.type).toBe(expected);
        expect(item.indent).toBeGreaterThanOrEqual(24);
        for (const li of item.items) {
          expect(li.display).toBe("list-item");
          expect(li.type).toBe(li.task ? "none" : expected);
          if (li.task) expect(li.disabled).toBe(true);
        }
      }
      expect(measured.lists.some((x) => x.start === 7)).toBe(true);
      expect(measured.lists.some((x) => x.start === 12)).toBe(true);
      expect(measured.lists.some((x) => x.footnote && x.type === "decimal")).toBe(true);
      expect(measured.outsideType).toBe("none");
      expect(measured.scrollWidth).toBe(measured.width);
      expect(measured.documentWidth).toBeLessThanOrEqual(viewport);
      expect(measured.fullPath).toBe(path);
      expect(measured.title).toBe(path);
      expect(measured.filename).toBe("actual-document-name.md");
      expect(parseFloat(measured.filenameSize!)).toBeGreaterThan(
        parseFloat(measured.directorySize!),
      );
      expect(measured.buttons.map((b) => b.name)).toEqual(["Preview", "Raw", "Outline", "Refresh"]);
      expect(measured.outlineBackground).not.toBeNull();
      expect(measured.outlineBackground).not.toBe("rgba(0, 0, 0, 0)");
      expect(measured.toolbar.height).toBeLessThanOrEqual(
        (measured.width <= 600 ? (name.endsWith("coarse") ? 108 : 100) : 64) * zoom,
      );
      expect(measured.identity).not.toBeNull();
      expect(measured.actions).not.toBeNull();
      if (measured.width <= 600)
        expect(measured.identity!.bottom).toBeLessThanOrEqual(measured.view.y);
      else
        expect(
          Math.abs(
            measured.identity!.y +
              measured.identity!.height / 2 -
              measured.view.y -
              measured.view.height / 2,
          ),
        ).toBeLessThan(2);
      expect(
        measured.actions!.x - measured.view.right >= 16 ||
          measured.actions!.y >= measured.view.bottom,
      ).toBe(true);
      for (const b of measured.buttons) {
        expect(b.height).toBeGreaterThanOrEqual(28 * zoom);
        expect(b.x).toBeGreaterThanOrEqual(measured.toolbar.x);
        expect(b.right).toBeLessThanOrEqual(measured.toolbar.right + 1);
      }
      const preview = reader.getByRole("button", { name: "Preview", exact: true });
      await preview.focus();
      const tooltip = reader.getByRole("tooltip");
      await expect(tooltip).toHaveText("Preview");
      let tipBox = await tooltip.boundingBox();
      expect(tipBox).not.toBeNull();
      expect(tipBox!.x).toBeGreaterThanOrEqual(0);
      expect(tipBox!.x + tipBox!.width).toBeLessThanOrEqual(viewport);
      await page.keyboard.press("Tab");
      expect(
        await reader
          .getByRole("button", { name: "Raw", exact: true })
          .evaluate((e) => e === document.activeElement && e.matches(":focus-visible")),
      ).toBe(true);
      await expect(tooltip).toHaveText("Raw");
      await page.keyboard.press("Space");
      expect(await reader.getByLabel("Raw Markdown").textContent()).toBe(
        await page.evaluate("presentationFixture.text"),
      );
      expect(
        await page.evaluate(
          "presentationFixture.inspection.rpcCalls.filter(c => c.method === 'read_document').length",
        ),
      ).toBe(1);
      await page.keyboard.press("Tab");
      expect(
        await reader
          .getByRole("button", { name: "Refresh", exact: true })
          .evaluate((e) => e === document.activeElement),
      ).toBe(true);
      await preview.click();
      await page.mouse.move(0, 999);
      const icons = reader.locator(".mr-toolbar [data-icon]");
      await expect(icons).toHaveCount(4);
      for (const icon of await icons.all()) {
        await expect(icon).toHaveAttribute("aria-hidden", "true");
        expect(
          await icon.evaluate((e) => {
            const mask = getComputedStyle(e, "::before").maskImage;
            return !!mask && mask !== "none";
          }),
        ).toBe(true);
      }
      const raw = reader.getByRole("button", { name: "Raw", exact: true });
      const outline = reader.getByRole("button", { name: "Outline", exact: true });
      const refresh = reader.getByRole("button", { name: "Refresh", exact: true });
      for (const action of [preview, raw, outline, refresh]) {
        const box = await action.boundingBox();
        expect(box).not.toBeNull();
        const target = name.endsWith("coarse") ? 36 : 28;
        expect(box!.width).toBe(target * zoom);
        expect(box!.height).toBe(target * zoom);
        await expect(action).toHaveText("");
      }
      await preview.focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      expect(
        await outline.evaluate((e) => e === document.activeElement && e.matches(":focus-visible")),
      ).toBe(true);
      await expect(tooltip).toHaveText("Outline");
      await expect(outline).toHaveAttribute(
        "aria-describedby",
        (await tooltip.getAttribute("id"))!,
      );
      await page.keyboard.press("Escape");
      await expect(tooltip).toHaveCount(0);
      await page.keyboard.press("Space");
      await expect(outline).toHaveAttribute("aria-pressed", "false");
      await page.keyboard.press("Space");
      await expect(outline).toHaveAttribute("aria-pressed", "true");
      await page.keyboard.press("Tab");
      await expect(tooltip).toHaveText("Refresh");
      await page.keyboard.press("Enter");
      await expect
        .poll(() =>
          page.evaluate(
            "presentationFixture.inspection.rpcCalls.filter(c => c.method === 'read_document').length",
          ),
        )
        .toBe(2);
      await preview.focus();
      await page.keyboard.press("Escape");
      await expect(tooltip).toHaveCount(0);
      await outline.hover();
      await expect(tooltip).toHaveText("Outline");
      tipBox = await tooltip.boundingBox();
      expect(tipBox).not.toBeNull();
      expect(tipBox!.x).toBeGreaterThanOrEqual(0);
      expect(tipBox!.x + tipBox!.width).toBeLessThanOrEqual(viewport);
      await tooltip.hover();
      await expect(tooltip).toBeVisible();
      await page.mouse.move(0, 999);
      await expect(tooltip).toHaveCount(0);
      for (const action of [outline, refresh]) {
        await action.hover();
        await expect(tooltip).toBeVisible();
        await expect(preview).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(tooltip).toHaveCount(0);
        await expect(action).not.toHaveAttribute("aria-describedby");
        await expect(preview).toBeFocused();
        await page.mouse.move(0, 999);
      }
      const screenshot = await capture(page, info, name);
      await results(info, {
        case: name,
        hostReset: RESET,
        zoom,
        computed: measured,
        capture: screenshot.path,
        sha256: screenshot.sha256,
        rawExact: true,
        focusOrder: true,
        pageErrors,
      });
    });
  });
}
