import { test, expect, capture, results } from "./fixture";
import { measureDocument } from "../../../packages/markdown-document/test/parity";
import { writeFile } from "node:fs/promises";

for (const width of [390, 960])
  for (const theme of ["light", "dark"]) {
    test(`shared parity reader ${width}-${theme}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/presentation-preview.html?parity&width=${width}&theme=${theme}`);
      await expect(
        page.getByRole("heading", { name: "Shared technical report", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Outline", exact: true }).click();
      await expect(page.getByRole("link", { name: "Relative note", exact: true })).toBeVisible();
      const snapshot = await page.evaluate(measureDocument);
      expect(snapshot.width).toBe(width === 390 ? 300 : 640);
      expect(snapshot.headings).toEqual([
        ["H1", "Shared technical report"],
        ["H2", "日本語 findings"],
        ["H2", "日本語 findings"],
        ["H3", "Detail"],
      ]);
      expect(snapshot.content).not.toContain("Presentation metadata");
      expect(snapshot.orderedStart).toBe("7");
      expect(snapshot.checkboxes).toEqual([
        [true, true],
        [false, true],
      ]);
      expect(snapshot.overflow).toEqual({ page: false, code: true, table: "auto" });
      await page.getByRole("link", { name: "Local heading", exact: true }).click();
      const target = page.getByRole("heading", { name: "日本語 findings", exact: true }).nth(1);
      await expect(target).toBeFocused();
      const ids = await page
        .locator(".mr-prose [id]")
        .evaluateAll((nodes) => nodes.map((node) => node.id));
      expect(new Set(ids).size).toBe(ids.length);
      const hash = await page.evaluate(() => location.hash);
      expect(hash).toBe("");
      await page.getByRole("button", { name: "Raw", exact: true }).click();
      const raw = await page.getByLabel("Raw Markdown").textContent();
      await page.getByRole("button", { name: "Preview", exact: true }).click();
      expect(
        await page.evaluate(
          "window.presentationFixture.inspection.rpcCalls.filter(c => c.method === 'read_document').length",
        ),
      ).toBe(1);
      await expect(
        page.getByRole("heading", { name: "Adjacent chrome", includeHidden: true }),
      ).toHaveCSS("font-size", "13px");
      const evidence = { ...snapshot, raw };
      if (process.env.BBP57_PARITY_DIR)
        await writeFile(
          `${process.env.BBP57_PARITY_DIR}/reader-${width}-${theme}.json`,
          JSON.stringify(evidence, null, 2),
        );
      await results(info, evidence);
      await capture(page, info, "reader-parity");
    });
  }
