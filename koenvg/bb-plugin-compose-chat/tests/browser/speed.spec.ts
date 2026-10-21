import { expect, test } from "@playwright/test";

const cases = [
  ...["dark", "light", "custom"].flatMap((theme) =>
    ["expanded", "compact", "new"].map((layout) => ({ theme, layout, mobile: false })),
  ),
  ...["expanded", "compact", "new"].map((layout) => ({ theme: "dark", layout, mobile: true })),
];
for (const { theme, layout, mobile } of cases) {
  test.describe(`speed border ${theme} ${layout} ${mobile ? "mobile" : "desktop"}`, () => {
    test.use({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1046 },
      hasTouch: mobile,
      isMobile: mobile,
    });
    test("tracks tiers and settings without changing the native composer", async ({ page }) => {
      await page.goto(`/tests/preview.html?theme=${theme}&layout=${layout}`);
      await page.waitForFunction(() => window.fixture?.ready);
      const composer = page.locator("[data-app-composer]");
      const frame = composer.locator(
        layout === "expanded" ? "[data-follow-up-composer]" : "form[data-promptbox]",
      );
      const field = composer.getByRole("textbox", { name: "Message" });
      const title = composer.locator('button[aria-label^="Provider, model and reasoning"] [title]');
      await field.fill("Keep my speed-mode draft");
      const native = await frame.evaluate((el) => ({
        html: el.innerHTML,
        rect: JSON.stringify(el.getBoundingClientRect()),
        background: getComputedStyle(el).backgroundImage,
      }));
      await composer.evaluate((el) => {
        const span = document.createElement("span");
        span.title = "Codex (Ultrafast mode)";
        el.append(span);
      });
      await expect(page.locator(".compose-speed-layer")).toHaveCount(0);
      for (const tier of ["Fast", "Ultrafast"]) {
        await title.evaluate((el, tier) => el.setAttribute("title", `Codex (${tier} mode)`), tier);
        const layer = page.locator(`.compose-speed-layer[data-speed="${tier}"]`);
        await expect(layer).toHaveCount(1);
        await expect(layer).toHaveAttribute("data-effect", "Glow");
        const expectedColor =
          theme === "light"
            ? tier === "Fast"
              ? "#7fc9df"
              : "#96d3e5"
            : tier === "Fast"
              ? "#c8a260"
              : "#e4ba6d";
        expect(
          await layer
            .locator(".compose-speed-frame")
            .evaluate((el) =>
              getComputedStyle(el).getPropertyValue("--compose-speed-color").trim(),
            ),
        ).toBe(expectedColor);
        expect(
          await layer
            .locator(".border-glow-card")
            .evaluate((el) => getComputedStyle(el).backgroundColor),
        ).toBe("rgba(0, 0, 0, 0)");
        expect(
          await layer
            .locator(".border-glow-inner")
            .evaluate((el) => getComputedStyle(el).backgroundColor),
        ).toBe("rgba(0, 0, 0, 0)");
        expect(
          await layer
            .locator(".border-glow-card")
            .evaluate((el) => getComputedStyle(el, "::before").maskComposite),
        ).toContain("exclude");
        const dimensions = await layer.locator(".compose-speed-frame").boundingBox();
        const bounds = await frame.boundingBox();
        expect(dimensions!.x).toBeCloseTo(bounds!.x, 1);
        expect(dimensions!.y).toBeCloseTo(bounds!.y, 1);
        expect(dimensions!.width).toBeCloseTo(bounds!.width, 1);
        if (layout !== "new") expect(dimensions!.height).toBeCloseTo(bounds!.height, 1);
        const corner = await layer
          .locator(".border-glow-card")
          .evaluate((el) => parseFloat(getComputedStyle(el).getPropertyValue("--cursor-angle")));
        if (tier === "Ultrafast") {
          expect(corner).toBeCloseTo(
            (Math.atan2(dimensions!.width, dimensions!.height) * 180) / Math.PI,
            2,
          );
          expect(
            await layer.locator(".edge-light").evaluate((el) => getComputedStyle(el).maskImage),
          ).toContain("repeating-conic-gradient");
        }
        expect(await frame.evaluate((el) => getComputedStyle(el).backgroundImage)).toBe(
          native.background,
        );
        await expect(field).toHaveValue("Keep my speed-mode draft");
        expect(await field.evaluate((el) => el === window.fixture.originalInput)).toBe(true);
        expect(await frame.evaluate((el) => JSON.stringify(el.getBoundingClientRect()))).toBe(
          native.rect,
        );
        expect(await layer.locator("button, textarea, input, form").count()).toBe(0);
        const hit = await field.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === el;
        });
        expect(hit).toBe(true);
      }
      await page.evaluate(() => window.fixture.setSpeedEffect("Off"));
      await expect(page.locator(".compose-speed-layer")).toHaveCount(0);
      await page.evaluate(() => window.fixture.setSpeedEffect("Glow"));
      await expect(page.locator(".compose-speed-layer")).toHaveCount(1);
      await title.evaluate((el) => el.setAttribute("title", "Codex"));
      await expect(page.locator(".compose-speed-layer")).toHaveCount(0);
      await page.getByRole("button", { name: "Disable style" }).click();
      await expect(page.locator(".compose-speed-layer")).toHaveCount(0);
      await expect(field).toHaveValue("Keep my speed-mode draft");
    });
  });
}

test("Electric motion stays bounded, stops on switch, hide and reduced motion", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = { draws: 0, deleted: 0 };
    (window as unknown as { speedProbe: typeof state }).speedProbe = state;
    const draw = WebGL2RenderingContext.prototype.drawArrays,
      del = WebGL2RenderingContext.prototype.deleteProgram;
    WebGL2RenderingContext.prototype.drawArrays = function (...args) {
      state.draws++;
      return draw.apply(this, args);
    };
    WebGL2RenderingContext.prototype.deleteProgram = function (...args) {
      state.deleted++;
      return del.apply(this, args);
    };
  });
  await page.goto("/tests/preview.html");
  await page.waitForFunction(() => window.fixture?.ready);
  await page
    .locator('button[aria-label^="Provider, model and reasoning"] [title]')
    .evaluate((el) => el.setAttribute("title", "Codex (Ultrafast mode)"));
  await page.evaluate(() => window.fixture.setSpeedEffect("Electric", true));
  await expect(page.locator(".compose-speed-layer canvas")).toHaveCount(1);
  const probe = () =>
    page.evaluate(
      () => (window as unknown as { speedProbe: { draws: number; deleted: number } }).speedProbe,
    );
  await expect.poll(async () => (await probe()).draws).toBeGreaterThan(0);
  const pixels = await page
    .locator(".compose-speed-layer canvas")
    .evaluate((el) => (el as HTMLCanvasElement).width * (el as HTMLCanvasElement).height);
  expect(pixels).toBeLessThanOrEqual(200000);
  const frame = page.locator("[data-follow-up-composer]");
  await frame.evaluate((el) => ((el as HTMLElement).style.opacity = "0"));
  await expect(page.locator(".compose-speed-layer")).toBeHidden();
  await page.waitForTimeout(150);
  const transparent = (await probe()).draws;
  await page.waitForTimeout(200);
  expect((await probe()).draws).toBe(transparent);
  await frame.evaluate((el) => ((el as HTMLElement).style.opacity = "1"));
  await expect(page.locator(".compose-speed-layer")).toBeVisible();
  await expect.poll(async () => (await probe()).draws).toBeGreaterThan(transparent);
  const before = (await probe()).draws;
  await page.waitForTimeout(1000);
  expect((await probe()).draws - before).toBeLessThanOrEqual(17);
  await page.evaluate(() => window.fixture.setSpeedEffect("Electric", false));
  await page.waitForTimeout(150);
  const paused = (await probe()).draws;
  await page.waitForTimeout(200);
  expect((await probe()).draws).toBe(paused);
  await page.evaluate(() => window.fixture.setSpeedEffect("Electric", true));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(150);
  const reduced = (await probe()).draws;
  await page.waitForTimeout(200);
  expect((await probe()).draws).toBe(reduced);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(150);
  const hidden = (await probe()).draws;
  await page.waitForTimeout(200);
  expect((await probe()).draws).toBe(hidden);
  await page.evaluate(() => {
    delete (document as unknown as { visibilityState?: string }).visibilityState;
    document.dispatchEvent(new Event("visibilitychange"));
    window.fixture.setSpeedEffect("Glow");
  });
  await expect(page.locator(".compose-speed-layer canvas")).toHaveCount(0);
  expect((await probe()).deleted).toBeGreaterThan(0);
  const stopped = (await probe()).draws;
  await page.waitForTimeout(200);
  expect((await probe()).draws).toBe(stopped);
});

test("Electric backing pixels never exceed the hard cap across frame sizes", async ({ page }) => {
  await page.goto("/tests/preview.html");
  await page.waitForFunction(() => window.fixture?.ready);
  await page
    .locator('button[aria-label^="Provider, model and reasoning"] [title]')
    .evaluate((el) => el.setAttribute("title", "Codex (Ultrafast mode)"));
  await page.evaluate(() => window.fixture.setSpeedEffect("Electric", false));
  const frame = page.locator("[data-follow-up-composer]");
  const sizes = [
    [700, 250],
    [1000, 200],
    [1600, 500],
    [391, 141],
    [3200, 900],
  ];
  for (const [width, height] of sizes) {
    await frame.evaluate(
      (el, [w, h]) => {
        (el as HTMLElement).style.width = `${w}px`;
        (el as HTMLElement).style.height = `${h}px`;
      },
      [width, height],
    );
    await expect
      .poll(async () => (await page.locator(".compose-speed-frame").boundingBox())?.width)
      .toBe(width);
    await expect
      .poll(async () => (await page.locator(".compose-speed-frame").boundingBox())?.height)
      .toBe(height);
    const canvas = page.locator(".compose-speed-layer canvas");
    await expect
      .poll(async () => canvas.evaluate((el) => parseFloat((el as HTMLCanvasElement).style.width)))
      .toBe(width + 64);
    expect(
      await canvas.evaluate(
        (el) => (el as HTMLCanvasElement).width * (el as HTMLCanvasElement).height,
      ),
    ).toBeLessThanOrEqual(200000);
  }
});

for (const theme of ["dark", "light"])
  for (const tier of ["Fast", "Ultrafast"]) {
    test(`Glow follows the page pointer outside the composer in ${theme} ${tier}`, async ({
      page,
    }) => {
      await page.goto(`/tests/preview.html?theme=${theme}`);
      await page.waitForFunction(() => window.fixture?.ready);
      await page
        .locator('button[aria-label^="Provider, model and reasoning"] [title]')
        .evaluate((el, tier) => el.setAttribute("title", `Codex (${tier} mode)`), tier);
      const card = page.locator(".compose-speed-layer .border-glow-card");
      await expect(card).toHaveCount(1);
      const bounds = (await page.locator(".compose-speed-frame").boundingBox())!;
      const angle = () =>
        card.evaluate((el) => parseFloat(getComputedStyle(el).getPropertyValue("--cursor-angle")));
      for (const [x, y] of [
        [25, 120],
        [900, 150],
      ]) {
        expect(y).toBeLessThan(bounds.y);
        await page.mouse.move(x, y);
        const expected =
          (Math.atan2(y - bounds.y - bounds.height / 2, x - bounds.x - bounds.width / 2) * 180) /
            Math.PI +
          90;
        await expect.poll(angle).toBeCloseTo(expected, 2);
        expect(
          await card.evaluate((el) => getComputedStyle(el).getPropertyValue("--edge-proximity")),
        ).toBe("100");
      }
      const settled = await angle();
      await page.waitForTimeout(150);
      expect(await angle()).toBe(settled);
      await page.evaluate(() => document.dispatchEvent(new Event("pointerleave")));
      await expect
        .poll(angle)
        .toBeCloseTo(
          tier === "Ultrafast" ? (Math.atan2(bounds.width, bounds.height) * 180) / Math.PI : 45,
          2,
        );
      expect(
        await page
          .getByRole("textbox", { name: "Message" })
          .evaluate((el) => el === window.fixture.originalInput),
      ).toBe(true);
      await page.evaluate(() => window.fixture.setSpeedEffect("Off"));
      await expect(page.locator(".compose-speed-layer")).toHaveCount(0);
      await page.mouse.move(100, 200);
    });
  }
