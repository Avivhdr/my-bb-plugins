import { test, expect, capture, results } from "./fixture";

test("refresh retains stale Preview and Raw, failed Retry, bound Original", async ({
  page,
  pageErrors,
}, info) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.goto("/?width=760&theme=light&refresh=error");
  const preview = page.getByRole("article", { name: "Markdown preview" });
  await preview.waitFor();
  const before = await preview.innerText();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByText("Refresh failed. Showing stale snapshot.", { exact: true }).waitFor();
  expect(await preview.innerText()).toBe(before);
  const screenshot = await capture(page, info, "refresh-stale-760");
  await page.getByRole("button", { name: "Raw", exact: true }).click();
  const raw = await page.getByLabel("Raw Markdown").innerText();
  await expect(page.getByRole("alert")).toContainText("Refresh failed. Showing stale snapshot.");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page.getByText("Refresh failed. Showing stale snapshot.", { exact: true }).waitFor();
  expect(await page.getByLabel("Raw Markdown").innerText()).toBe(raw);
  const geometry = await page
    .locator(".markdown-reader")
    .evaluate((e) => ({ width: e.clientWidth, scrollWidth: e.scrollWidth }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width);
  await page.getByRole("button", { name: "Open in BB preview", exact: true }).click();
  await page
    .getByText("Bound BB preview placeholder. No plugin selection occurs.", { exact: true })
    .waitFor();
  await results(info, {
    retainedPreview: true,
    staleRaw: true,
    failedRetry: true,
    boundOriginal: true,
    geometry,
    pageErrors,
    screenshot,
  });
});
