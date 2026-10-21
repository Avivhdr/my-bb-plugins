import { test, expect, raster, capture, results } from "./fixture";
import type { Route } from "@playwright/test";

const png = raster(1200, 220, [96, 132, 152]);
for (const source of ["workspace", "host", "thread-storage"] as const) {
  for (const [width, theme] of [
    [1440, "light"],
    [760, "light"],
    [390, "dark"],
  ] as const) {
    test(`destinations ${source}-${width}-${theme}`, async ({ page, pageErrors }, info) => {
      await page.setViewportSize({ width: Math.max(width, 1000), height: 850 });
      const requests: { url: string; headers: Record<string, string> }[] = [];
      const imageRoute = async (route: Route) => {
        requests.push({ url: route.request().url(), headers: route.request().headers() });
        if (route.request().url().includes("escape_png"))
          await route.fulfill({ status: 403, body: "Confined fixture denial" });
        else
          await route.fulfill({
            status: 200,
            contentType: "image/png",
            headers: { "access-control-allow-origin": "*" },
            body: png,
          });
      };
      await page.route("**/api/v1/plugins/markdown-reader/http/image?asset=*", imageRoute);
      await page.route("https://images.test/**", imageRoute);
      await page.clock.install();
      await page.goto(
        `/tests/destination-preview.html?source=${source}&width=${width}&theme=${theme}`,
      );
      await page.getByRole("link", { name: "sibling", exact: true }).waitFor();
      const local = page.getByRole("img", { name: "Local picture", exact: true });
      await local.scrollIntoViewIfNeeded();
      await page.waitForFunction(
        "[...document.images].find(e => e.alt === 'Local picture')?.naturalWidth === 1200",
      );
      expect(
        await local.evaluate((e) => e.clientWidth <= e.closest(".mr-prose")!.clientWidth),
      ).toBe(true);
      await page.getByText("Confined symlink alt", { exact: false }).waitFor();
      const enlarge = page.getByRole("button", {
        name: "Enlarge image: Local picture",
        exact: true,
      });
      await expect(enlarge).toBeEnabled();
      await expect(page.locator("a button, button a")).toHaveCount(0);
      await expect(
        page.getByRole("link", { name: "Open linked destination: Local picture", exact: true }),
      ).toBeVisible();
      const approvedSrc = await local.getAttribute("src");
      await enlarge.focus();
      await page.keyboard.press("Space");
      const viewer = page.getByRole("dialog", {
        name: "Image preview: Local picture",
        exact: true,
      });
      await expect(viewer).toBeVisible();
      await expect(viewer.getByRole("img")).toHaveAttribute("src", approvedSrc!);
      await expect(viewer.getByRole("img")).toHaveAttribute("referrerpolicy", "no-referrer");
      const close = viewer.getByRole("button", { name: "Close image preview" });
      await expect(close).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(close).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(close).toBeFocused();
      const imageBounds = await viewer.getByRole("img").boundingBox();
      expect(imageBounds!.width).toBeLessThanOrEqual(1200);
      expect(imageBounds!.height / imageBounds!.width).toBeCloseTo(220 / 1200, 2);
      await capture(page, info, `image-preview-${source}-${width}-${theme}`);
      await page.keyboard.press("Escape");
      await expect(viewer).toHaveCount(0);
      await expect(enlarge).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(viewer).toBeVisible();
      await close.click();
      await expect(enlarge).toBeFocused();
      await expect(page.locator("html")).toHaveAttribute("data-fixture-resolutions", "1");
      expect(await page.evaluate("window.destinationFixture.inspection.navigateCalls.length")).toBe(
        0,
      );
      await expect(page.getByRole("img", { name: "Confined symlink alt" })).toHaveCount(0);
      await page.getByText("Rejected SVG alt", { exact: true }).waitFor();
      const imageRequests = requests.length;
      await page.clock.fastForward(120000);
      await expect(local).toBeVisible();
      expect(await local.evaluate((e) => (e as HTMLImageElement).naturalWidth)).toBe(1200);
      expect(requests).toHaveLength(imageRequests);
      await expect(page.getByRole("link", { name: "script", exact: true })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "escape", exact: true })).toHaveCount(0);
      for (const name of ["sibling", "web"]) {
        await page.getByRole("link", { name, exact: true }).focus();
        await page.keyboard.press("Enter");
      }
      const calls = await page.evaluate<{ method: string; options: { target: object } }[]>(
        "window.destinationFixture.inspection.navigateCalls",
      );
      expect(calls[0].method).toBe("experimental_openFilePreview");
      const expected =
        source === "host"
          ? { kind: "host", hostId: "remote", path: "/notes/next.md" }
          : {
              kind: source,
              path: "reports/next.md",
              ...(source === "workspace" ? { environmentId: "env" } : { threadId: "thread" }),
            };
      expect(calls[0].options.target).toEqual(expected);
      expect(calls[1]).toEqual({ method: "openUrl", url: "https://example.com/guide" });
      await page.getByRole("link", { name: "here", exact: true }).click();
      expect(
        await page
          .getByRole("heading", { name: "Destinations", exact: true })
          .evaluate((e) => e === document.activeElement),
      ).toBe(true);
      await page.locator(".mr-prose sup a").click();
      expect(await page.evaluate("document.activeElement?.tagName")).toBe("LI");
      expect(await page.evaluate("location.hash")).toBe("");
      expect(await page.evaluate("window.destinationFixture.inspection.navigateCalls.length")).toBe(
        2,
      );
      await expect(page.locator("html")).toHaveAttribute("data-fixture-reads", "1");
      await page
        .getByRole("link", { name: "Open linked destination: Local picture", exact: true })
        .click();
      expect(await page.evaluate("window.destinationFixture.inspection.navigateCalls.length")).toBe(
        3,
      );
      expect(await page.evaluate("window.destinationFixture.inspection.navigateCalls[2]")).toEqual(
        calls[0],
      );
      const oldSrc = await local.getAttribute("src");
      await page.getByRole("button", { name: "Raw", exact: true }).click();
      expect(await page.getByLabel("Raw Markdown", { exact: true }).textContent()).toBe(
        await page.evaluate("window.destinationFixture.text"),
      );
      await page.getByRole("button", { name: "Preview", exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("data-fixture-resolutions", "1");
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await page.waitForFunction("document.documentElement.dataset.fixtureResolutions === '2'");
      await expect(local).not.toHaveAttribute("src", oldSrc!);
      await local.scrollIntoViewIfNeeded();
      await page.waitForFunction(
        "[...document.images].find(e => e.alt === 'Local picture')?.naturalWidth === 1200",
      );
      await page.getByRole("img", { name: "Remote picture", exact: true }).scrollIntoViewIfNeeded();
      await page.waitForFunction(
        "[...document.images].find(e => e.alt === 'Remote picture')?.naturalWidth === 1200",
      );
      expect(requests.every((r) => !("referer" in r.headers))).toBe(true);
      expect(requests.some((r) => r.url === "https://images.test/picture.png")).toBe(true);
      expect(requests.some((r) => r.url.includes("outside") || r.url.includes("active.svg"))).toBe(
        false,
      );
      const screenshot = await capture(page, info, `${source}-${width}-${theme}`);
      await page
        .getByRole("button", { name: "Enlarge image: Remote picture", exact: true })
        .click();
      const remoteViewer = page.getByRole("dialog", {
        name: "Image preview: Remote picture",
        exact: true,
      });
      await expect(remoteViewer.getByRole("img")).toHaveAttribute("crossorigin", "anonymous");
      await expect(remoteViewer.getByRole("img")).toHaveAttribute(
        "src",
        "https://images.test/picture.png",
      );
      await expect(page.locator("html")).toHaveAttribute("data-fixture-resolutions", "2");
      await page.evaluate("window.destinationFixture.unmount()");
      await expect(page.locator(".markdown-reader")).toHaveCount(0);
      await expect(page.locator("dialog[open]")).toHaveCount(0);
      await results(info, {
        source,
        width,
        theme,
        sourceAwareOpening: true,
        localFragments: true,
        rawExact: true,
        imageSizing: true,
        getDeniedFallback: true,
        sameHashRefresh: true,
        ordinaryRemoteRequest: true,
        unmount: true,
        requests,
        errors: pageErrors,
        screenshot,
      });
    });
  }
}
for (const [width, theme] of [
  [1440, "light"],
  [390, "dark"],
] as const) {
  test(`small and tall image previews scroll within ${width}px with reduced motion`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 850 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.route("**/api/v1/plugins/markdown-reader/http/image?asset=*", (route) =>
      route.fulfill({
        contentType: "image/png",
        body: raster(30, 15, [96, 132, 152]),
      }),
    );
    await page.route("https://images.test/**", (route) =>
      route.fulfill({
        contentType: "image/png",
        headers: { "access-control-allow-origin": "*" },
        body: raster(1200, 2400, [96, 132, 152]),
      }),
    );
    await page.goto(`/tests/destination-preview.html?panel=viewport&width=${width}&theme=${theme}`);
    const small = page.getByRole("button", { name: "Enlarge image: Local picture", exact: true });
    await expect(small).toBeEnabled();
    const triggerBounds = await small.boundingBox();
    expect(triggerBounds!.width).toBeGreaterThanOrEqual(44);
    expect(triggerBounds!.height).toBeGreaterThanOrEqual(44);
    await small.click();
    const smallDialog = page.getByRole("dialog", {
      name: "Image preview: Local picture",
      exact: true,
    });
    await expect(smallDialog.getByRole("img")).toHaveJSProperty("naturalWidth", 30);
    const smallBounds = await smallDialog.getByRole("img").boundingBox();
    expect(smallBounds!.width).toBe(30);
    expect(smallBounds!.height).toBe(15);
    await page.keyboard.press("Escape");
    const tall = page.getByRole("button", { name: "Enlarge image: Remote picture", exact: true });
    await expect(tall).toBeEnabled();
    await tall.scrollIntoViewIfNeeded();
    const inlineBounds = await tall.getByRole("img").boundingBox();
    const background = () =>
      page.evaluate(() => ({
        window: scrollY,
        reader: document.querySelector(".markdown-reader")!.scrollTop,
      }));
    const before = await background();
    await capture(page, info, `tall-image-inline-${width}-${theme}`);
    await tall.click();
    const tallDialog = page.getByRole("dialog", {
      name: "Image preview: Remote picture",
      exact: true,
    });
    const image = tallDialog.getByRole("img");
    const close = tallDialog.getByRole("button", { name: "Close image preview" });
    await expect(image).toHaveJSProperty("naturalWidth", 1200);
    await expect(image).toHaveJSProperty("naturalHeight", 2400);
    await page.setViewportSize({ width, height: 500 });
    const bounds = await image.boundingBox();
    const dialogBounds = await tallDialog.boundingBox();
    expect(bounds!.width).toBe(width === 1440 ? 1200 : 324);
    expect(bounds!.width).toBeLessThanOrEqual(1200);
    if (width === 1440) expect(bounds!.width).toBeGreaterThan(inlineBounds!.width);
    expect(bounds!.height / bounds!.width).toBeCloseTo(2, 2);
    expect(dialogBounds!.y).toBeGreaterThanOrEqual(0);
    expect(dialogBounds!.y + dialogBounds!.height).toBeLessThanOrEqual(500);
    const scroll = () =>
      tallDialog.evaluate((element) => ({
        top: element.scrollTop,
        height: element.scrollHeight,
        client: element.clientHeight,
      }));
    const scrollEnd = () =>
      page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            document
              .querySelector(".mr-image-dialog")!
              .addEventListener("scrollend", () => resolve(), {
                once: true,
              }),
          ),
      );
    const initial = await scroll();
    expect(initial.height).toBeGreaterThan(initial.client);
    expect(initial.top).toBe(0);
    const closeBounds = await close.boundingBox();
    await capture(page, info, `tall-image-resize-${width}-${theme}`);
    await Promise.all([scrollEnd(), page.keyboard.press("PageDown")]);
    expect((await scroll()).top).toBeGreaterThan(100);
    const afterPage = await scroll();
    await Promise.all([scrollEnd(), page.keyboard.press("PageUp")]);
    expect((await scroll()).top).toBe(0);
    await page.mouse.move(bounds!.x + bounds!.width / 2, 350);
    await Promise.all([scrollEnd(), page.mouse.wheel(0, 10000)]);
    await expect
      .poll(async () => {
        const current = await scroll();
        return current.height - current.client - current.top;
      })
      .toBeLessThanOrEqual(1);
    expect((await scroll()).top).toBeGreaterThan(100);
    const bottom = await image.boundingBox();
    expect(bottom!.y + bottom!.height).toBeLessThanOrEqual(dialogBounds!.y + dialogBounds!.height);
    expect(bottom!.y + bottom!.height).toBeGreaterThan(400);
    await expect(close).toBeInViewport({ ratio: 1 });
    expect((await close.boundingBox())!.y).toBeCloseTo(closeBounds!.y, 0);
    await capture(page, info, `tall-image-bottom-${width}-${theme}`);
    expect(await background()).toEqual(before);
    const stickyClose = (await close.boundingBox())!;
    await page.mouse.click(
      stickyClose.x + stickyClose.width / 2,
      stickyClose.y + stickyClose.height / 2,
    );
    await expect(tallDialog).toHaveCount(0);
    await expect(tall).toBeFocused();
    expect(await background()).toEqual(before);
    await page.keyboard.press("Enter");
    await expect(tallDialog).toBeVisible();
    await page.keyboard.press("PageDown");
    await expect.poll(async () => (await scroll()).top).toBeGreaterThan(100);
    await page.keyboard.press("Escape");
    await expect(tallDialog).toHaveCount(0);
    await expect(tall).toBeFocused();
    expect(await background()).toEqual(before);
    await results(info, { inlineBounds, bounds, initial, afterPage, background: before });
  });
}
