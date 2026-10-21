import { test, expect, capture, results } from "./fixture";

test.use({ launchOptions: { args: ["--blink-settings=caretBrowsingEnabled=true"] } });
declare global {
  interface Window {
    revealSelectionLines: (start: number | null, end: number | null) => void;
  }
}

const source =
  "\uFEFF# Dense\r\n" + "\n".repeat(30_000) + "  alpha **one**\r\n\r\n  beta `two`\r\n";

test("newline-dense Raw keeps bounded DOM, exact text, inclusive reveal and repeated focus", async ({
  page,
}, info) => {
  await page.goto("/tests/selection-preview.html?document=dense");
  await page.getByRole("heading", { name: "Dense", exact: true }).waitFor();
  const rawButton = page.getByRole("button", { name: "Raw", exact: true });
  await rawButton.focus();
  await page.keyboard.press("Enter");
  const raw = page.getByLabel("Raw Markdown");
  expect(await raw.textContent()).toBe(source);
  expect(await raw.locator("*").count()).toBeLessThanOrEqual(132);
  await page.evaluate(() => window.revealSelectionLines(30_002, 30_003));
  const first = raw.locator('[data-source-line="30002"]');
  await expect(first).toBeFocused();
  expect(await raw.locator('[data-highlighted="true"]').allTextContents()).toEqual([
    "  alpha **one**\r\n",
    "\r\n",
  ]);
  const bounds = await first.evaluate((element) => {
    const target = element.getBoundingClientRect();
    const panel = element.closest(".markdown-reader")!;
    const reader = panel.getBoundingClientRect();
    const toolbar = panel.querySelector(".mr-toolbar")!.getBoundingClientRect();
    return { visible: target.top >= toolbar.bottom && target.bottom <= reader.bottom };
  });
  expect(bounds).toEqual({ visible: true });
  await rawButton.focus();
  await page.evaluate(() => window.revealSelectionLines(30_002, 30_003));
  await expect(first).toBeFocused();
  expect(await raw.textContent()).toBe(source);
  expect(await raw.locator("*").count()).toBeLessThanOrEqual(132);
  expect(
    await page.evaluate(() => window.selectionFixture.inspection.rpcCalls.map((c) => c.method)),
  ).toEqual(["read_document"]);
  await results(info, {
    sourceBytes: Buffer.byteLength(source),
    exactSource: (await raw.textContent()) === source,
    rawElements: await raw.locator("*").count(),
    focusedLine: await first.getAttribute("data-source-line"),
    repeatedIntent: true,
    ...bounds,
  });
  await capture(page, info, "dense-raw-range");
  const scrollBeforeClear = await raw.evaluate((element) => ({
    reader: element.closest(".markdown-reader")!.scrollTop,
    page: window.scrollY,
  }));
  await page.evaluate(() => window.revealSelectionLines(null, null));
  await expect(raw).toBeFocused();
  await expect(raw.locator('[data-highlighted="true"]')).toHaveCount(0);
  expect(
    await raw.evaluate((element) => ({
      reader: element.closest(".markdown-reader")!.scrollTop,
      page: window.scrollY,
    })),
  ).toEqual(scrollBeforeClear);
  expect(await raw.textContent()).toBe(source);
});

for (const requested of [false, true]) {
  test(`dense Raw selection cites inclusive lines with a reveal request ${requested}`, async ({
    page,
  }, info) => {
    await page.goto("/tests/selection-preview.html?document=dense");
    await page.getByRole("heading", { name: "Dense", exact: true }).waitFor();
    await page.getByRole("button", { name: "Raw", exact: true }).click();
    if (requested) {
      await page.evaluate(() => window.revealSelectionLines(30_002, 30_003));
      await expect(page.locator('[data-source-line="30002"]')).toBeFocused();
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          }),
      );
    }
    const raw = page.getByLabel("Raw Markdown");
    await raw.evaluate((root) => {
      const text = root.textContent!;
      const boundary = (offset: number): [Node, number] => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
          if (offset <= node.textContent!.length) return [node, offset];
          offset -= node.textContent!.length;
          node = walker.nextNode();
        }
        throw new Error("Selection offset outside source");
      };
      const range = document.createRange();
      range.setStart(...boundary(text.indexOf("alpha")));
      range.setEnd(...boundary(text.indexOf("  beta")));
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
    });
    const button = page.getByRole("button", { name: "Add to chat" });
    await button.click();
    const composer = await page.evaluate(() => {
      const value = window.selectionFixture.inspection.composer;
      return {
        text: value.text,
        attachments: value.attachmentCount,
        mentions: value.draft.mentions,
        focus: value.focusCount,
        sends: value.submits.length,
      };
    });
    expect(composer).toEqual({
      text: "Keep @owner\n\n> note.md:30002-30003\n> workspace · host remote\n> alpha **one**\n> \n> \n",
      attachments: 1,
      mentions: [{ kind: "thread", threadId: "owner", label: "@owner", from: 5, to: 11 }],
      focus: 1,
      sends: 0,
    });
    expect(await raw.textContent()).toBe(source);
    await results(info, { requested, ...composer });
  });
}

for (const activation of ["Enter", "Space"] as const) {
  test(`grouped Raw supports keyboard selection and ${activation} insertion`, async ({ page }) => {
    await page.goto("/tests/selection-preview.html?document=dense");
    await page.getByRole("heading", { name: "Dense", exact: true }).waitFor();
    await page.getByRole("button", { name: "Raw", exact: true }).click();
    await page.getByLabel("Raw Markdown").focus();
    await page.getByLabel("Raw Markdown").evaluate((root) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node && !node.textContent!.includes("alpha")) node = walker.nextNode();
      if (!node) throw new Error("Missing source text");
      const range = document.createRange();
      range.setStart(node, node.textContent!.indexOf("alpha"));
      range.collapse(true);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
    });
    await page.keyboard.down("Shift");
    for (let index = 0; index < 8; index++) await page.keyboard.press("ArrowRight");
    await page.keyboard.up("Shift");
    expect(await page.evaluate(() => window.getSelection()!.toString())).toBe("alpha **");
    const button = page.getByRole("button", { name: "Add to chat" });
    await button.waitFor();
    for (let index = 0; index < 10; index++) {
      if (await button.evaluate((element) => document.activeElement === element)) break;
      await page.keyboard.press("Tab");
    }
    await expect(button).toBeFocused();
    expect(await button.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
    await page.keyboard.press(activation);
    expect(await page.evaluate(() => window.selectionFixture.inspection.composer.text)).toBe(
      "Keep @owner\n\n> note.md:30002-30002\n> workspace · host remote\n> alpha **\n",
    );
    expect(await page.evaluate(() => window.selectionFixture.inspection.composer.focusCount)).toBe(
      1,
    );
    expect(
      await page.evaluate(() => window.selectionFixture.inspection.composer.submits.length),
    ).toBe(0);
  });
}

for (const ending of ["lf", "crlf"] as const) {
  test(`${ending} source rows remain stable through range splits and clearing`, async ({
    page,
  }, info) => {
    await page.goto(`/tests/selection-preview.html?document=rows&ending=${ending}`);
    await page.getByRole("heading", { name: "Rows", exact: true }).waitFor();
    await page.getByRole("button", { name: "Raw", exact: true }).click();
    const raw = page.getByLabel("Raw Markdown");
    const source = ["# Rows", ...Array.from({ length: 300 }, (_, i) => `line ${i + 1}`), ""].join(
      ending === "crlf" ? "\r\n" : "\n",
    );
    const rows = () =>
      raw.evaluate((element) => {
        element.style.lineHeight = "20px";
        const style = getComputedStyle(element);
        const edges = [
          style.paddingTop,
          style.paddingBottom,
          style.borderTopWidth,
          style.borderBottomWidth,
        ].reduce((sum, value) => sum + parseFloat(value), 0);
        return (element.getBoundingClientRect().height - edges) / 20;
      });
    expect(await raw.textContent()).toBe(source);
    expect(await rows()).toBe(302);
    expect(await raw.locator("*").count()).toBeLessThanOrEqual(132);
    await page.evaluate(() => window.revealSelectionLines(2, 4));
    await expect(raw.locator('[data-source-line="2"]')).toBeFocused();
    expect(await rows()).toBe(302);
    expect(await raw.textContent()).toBe(source);
    await page.evaluate(() => window.revealSelectionLines(null, null));
    await expect(raw).toBeFocused();
    expect(await rows()).toBe(302);
    expect(await raw.textContent()).toBe(source);
    await results(info, { ending, rows: await rows(), exactSource: true, focusRetained: true });
  });
}
