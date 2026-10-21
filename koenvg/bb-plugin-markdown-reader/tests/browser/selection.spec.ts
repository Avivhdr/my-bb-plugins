import type { RenderedSlot } from "@get-bb/plugin-sdk/testing/app";
import { test, expect, capture } from "./fixture";
test.use({ launchOptions: { args: ["--blink-settings=caretBrowsingEnabled=true"] } });

declare global {
  interface Window {
    changeSelectionFile: () => void;
    selectionFixture: RenderedSlot;
    secondSelectionFixture: RenderedSlot;
  }
}

test("Preview selection appends a quote to the associated draft and preserves its content", async ({
  page,
}, info) => {
  await page.goto("/tests/selection-preview.html");
  await page.getByText("Selected prose.", { exact: true }).waitFor();
  await page.getByText("Selected prose.", { exact: true }).evaluate((element) => {
    const range = document.createRange();
    range.setStart(element.firstChild!, 0);
    range.setEnd(element.firstChild!, 8);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.getByRole("button", { name: "Add to chat" }).waitFor();
  await capture(page, info, "selection-preview");
  await page.getByRole("button", { name: "Add to chat" }).click();
  expect(
    await page.evaluate(() => {
      const { composer, rpcCalls } = window.selectionFixture.inspection;
      return {
        text: composer.text,
        mentions: composer.draft.mentions,
        attachments: composer.attachmentCount,
        focus: composer.focusCount,
        sends: composer.submits.length,
        uploaded: composer.draft.attachments,
        calls: rpcCalls.map((call) => call.method),
      };
    }),
  ).toEqual({
    text: "Keep @owner\n\n> note.md\n> workspace · host remote\n> Selected\n",
    mentions: [{ kind: "thread", threadId: "owner", label: "@owner", from: 5, to: 11 }],
    attachments: 1,
    focus: 1,
    sends: 0,
    calls: ["read_document"],
    uploaded: [{ type: "localFile", name: "keep.txt", path: "/uploads/keep.txt", sizeBytes: 4 }],
  });
});

test("Raw selection preserves indentation and blank lines without adding the next line", async ({
  page,
}) => {
  await page.goto("/tests/selection-preview.html?document=raw");
  await page.getByRole("heading", { name: "Heading" }).waitFor();
  await page.getByRole("button", { name: "Raw", exact: true }).click();
  await page.getByLabel("Raw Markdown").evaluate((root) => {
    const spans = root.querySelectorAll("[data-source-line]");
    const range = document.createRange();
    range.setStart(spans[2]!.firstChild!, 0);
    range.setEnd(spans[4]!.firstChild!, 0);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
  });
  await page.getByRole("button", { name: "Add to chat" }).click();
  expect(await page.evaluate(() => window.selectionFixture.inspection.composer.text)).toBe(
    "Keep @owner\n\n> note.md:3-4\n> workspace · host remote\n>   alpha **one**\n> \n> \n",
  );
});

async function selectVisible(locator: import("@playwright/test").Locator) {
  await locator.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
  });
}
for (const [label, selector, excerpt] of [
  ["table", ".mr-prose td", "Table cell"],
  ["highlighted code", ".mr-prose pre code", "const answer = 42;"],
] as const) {
  test(`Preview quotes visible ${label} without source lines`, async ({ page }) => {
    await page.goto("/tests/selection-preview.html");
    const content = page.locator(selector).first();
    await content.waitFor();
    await selectVisible(content);
    await page.getByRole("button", { name: "Add to chat" }).click();
    expect(await page.evaluate(() => window.selectionFixture.inspection.composer.text)).toBe(
      `Keep @owner\n\n> note.md\n> workspace · host remote\n> ${excerpt}\n`,
    );
  });
}
test("a partial wrapped Raw line remains a single source line", async ({ page }) => {
  await page.goto("/tests/selection-preview.html?document=raw&width=180");
  await page.getByRole("heading", { name: "Heading" }).waitFor();
  await page.getByRole("button", { name: "Raw", exact: true }).click();
  const line = page.locator('[data-source-line="3"]');
  await line.evaluate((element) => {
    element.parentElement!.style.fontSize = "32px";
    const range = document.createRange();
    range.setStart(element.firstChild!, 2);
    range.setEnd(element.firstChild!, 15);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    if (range.getClientRects().length < 2) throw new Error("Expected a wrapped source selection");
  });
  await page.getByRole("button", { name: "Add to chat" }).click();
  expect(await page.evaluate(() => window.selectionFixture.inspection.composer.text)).toBe(
    "Keep @owner\n\n> note.md:3-3\n> workspace · host remote\n> alpha **one**\n",
  );
});
for (const dismissal of [
  "clear",
  "Escape",
  "outside",
  "scroll",
  "view",
  "composer",
  "Refresh",
  "unmount",
] as const) {
  test(`dismisses obsolete selection on ${dismissal}`, async ({ page }) => {
    await page.goto("/tests/selection-preview.html");
    const content = page.getByText("Selected prose.", { exact: true });
    await content.waitFor();
    await selectVisible(content);
    await page.getByRole("button", { name: "Add to chat" }).waitFor();
    if (dismissal === "clear") await page.evaluate(() => window.getSelection()!.removeAllRanges());
    if (dismissal === "Escape") await page.keyboard.press("Escape");
    if (dismissal === "outside") await page.locator(".mr-filename").click();
    if (dismissal === "scroll") await page.locator(".markdown-reader").dispatchEvent("scroll");
    if (dismissal === "view") await page.getByRole("button", { name: "Raw", exact: true }).click();
    if (dismissal === "composer")
      await page.evaluate(() =>
        window.selectionFixture.behavior.setComposerScope({ kind: "thread", threadId: "other" }),
      );
    if (dismissal === "Refresh") await page.getByRole("button", { name: "Refresh" }).click();
    if (dismissal === "unmount")
      await page.evaluate(() => window.selectionFixture.lifecycle.unmount());
    await page.evaluate(() => document.dispatchEvent(new Event("selectionchange")));
    await expect(page.getByRole("button", { name: "Add to chat" })).toHaveCount(0);
    expect(await page.evaluate(() => window.selectionFixture.inspection.composer.text)).toBe(
      "Keep @owner",
    );
    expect(await page.evaluate(() => window.selectionFixture.inspection.composer.submits)).toEqual(
      [],
    );
  });
}
test("failed refresh leaves copyable stale content without an action and permits Original", async ({
  page,
}) => {
  await page.goto("/tests/selection-preview.html?fail-refresh");
  const content = page.getByText("Selected prose.", { exact: true });
  await content.waitFor();
  await selectVisible(content);
  await page.getByRole("button", { name: "Add to chat" }).waitFor();
  await page.getByRole("button", { name: "Refresh" }).click();
  await page.getByText("Refresh failed. Showing stale snapshot.").waitFor();
  await selectVisible(content);
  expect(await page.evaluate(() => window.getSelection()!.toString())).toBe("Selected prose.");
  await expect(page.getByRole("button", { name: "Add to chat" })).toHaveCount(0);
  await page.getByRole("button", { name: "Retry" }).click();
  await page.getByText("Refresh failed. Showing stale snapshot.").waitFor();
  await page.getByRole("button", { name: "Open in BB preview" }).click();
  await expect(page.getByText("Original fixture")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add to chat" })).toHaveCount(0);
});
test("rejects whitespace, outline, controls and cross-document selections", async ({ page }) => {
  await page.goto("/tests/selection-preview.html?document=raw");
  await page.getByRole("heading", { name: "Heading" }).waitFor();
  await selectVisible(page.locator(".mr-filename"));
  await expect(page.getByRole("button", { name: "Add to chat" })).toHaveCount(0);
  await page.getByRole("button", { name: "Raw", exact: true }).click();
  await selectVisible(page.locator('[data-source-line="4"]'));
  await expect(page.getByRole("button", { name: "Add to chat" })).toHaveCount(0);
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.locator(".mr-outline-inline summary").click();
  await selectVisible(page.locator(".mr-outline-inline"));
  await expect(page.getByRole("button", { name: "Add to chat" })).toHaveCount(0);
  await page.evaluate(() => {
    const range = document.createRange();
    range.setStart(document.querySelector(".mr-filename")!.firstChild!, 0);
    range.setEnd(document.querySelector(".mr-prose p")!.firstChild!, 3);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
  });
  await expect(page.getByRole("button", { name: "Add to chat" })).toHaveCount(0);
});
test("two readers isolate selection and destination, including after unmount", async ({ page }) => {
  await page.goto("/tests/selection-preview.html?two");
  await page.getByText("Second reader prose.", { exact: true }).waitFor();
  await selectVisible(page.getByText("Second reader prose.", { exact: true }));
  await expect(
    page.locator(".markdown-reader").first().getByRole("button", { name: "Add to chat" }),
  ).toHaveCount(0);
  await page
    .locator(".markdown-reader")
    .last()
    .getByRole("button", { name: "Add to chat" })
    .click();
  expect(await page.evaluate(() => window.selectionFixture.inspection.composer.text)).toBe(
    "Keep @owner",
  );
  expect(await page.evaluate(() => window.secondSelectionFixture.inspection.composer.text)).toBe(
    "> note.md\n> workspace · host remote\n> Second reader prose.\n",
  );
  await selectVisible(page.getByText("Second reader prose.", { exact: true }));
  await page.evaluate(() => window.secondSelectionFixture.lifecycle.unmount());
  await selectVisible(page.getByText("Selected prose.", { exact: true }));
  await expect(page.getByRole("button", { name: "Add to chat" })).toHaveCount(1);
});

test("loading retained text has no action and needs a new selection after read completion", async ({
  page,
}) => {
  await page.goto("/tests/selection-preview.html?hold-refresh");
  const content = page.getByText("Selected prose.", { exact: true });
  await content.waitFor();
  await selectVisible(content);
  await page.getByRole("button", { name: "Add to chat" }).waitFor();
  await page.getByRole("button", { name: "Refresh" }).click();
  await page
    .getByText("Refreshing Markdown. Showing previous snapshot, not verified current.")
    .waitFor();
  await selectVisible(content);
  await expect(page.getByRole("button", { name: "Add to chat" })).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event("fixture-release-read")));
  await expect(page.getByRole("status")).toHaveCount(0);
  await page.evaluate(() => document.dispatchEvent(new Event("selectionchange")));
  await expect(page.getByRole("button", { name: "Add to chat" })).toHaveCount(0);
});

for (const activation of ["Enter", "Space"] as const) {
  test(`keyboard-created selection has visible focus and ${activation} activation`, async ({
    page,
  }) => {
    await page.goto("/tests/selection-preview.html");
    const content = page.getByText("Selected prose.", { exact: true });
    await content.waitFor();
    await content.evaluate((element) => {
      const range = document.createRange();
      range.setStart(element.firstChild!, 0);
      range.collapse(true);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
    });
    await page.keyboard.down("Shift");
    for (let index = 0; index < 8; index++) await page.keyboard.press("ArrowRight");
    await page.keyboard.up("Shift");
    expect(await page.evaluate(() => window.getSelection()!.toString())).toBe("Selected");
    const button = page.getByRole("button", { name: "Add to chat" });
    await button.waitFor();
    // Tab must reach the action without a shortcut or pointer activation.
    for (
      let index = 0;
      index < 10 && !(await button.evaluate((element) => document.activeElement === element));
      index++
    )
      await page.keyboard.press("Tab");
    expect(
      await button.evaluate((element) => ({
        active: document.activeElement === element,
        visible: element.matches(":focus-visible"),
        outline: getComputedStyle(element).outlineStyle,
        width: getComputedStyle(element).outlineWidth,
      })),
    ).toEqual({ active: true, visible: true, outline: "solid", width: "2px" });
    await page.keyboard.press(activation);
    expect(await page.evaluate(() => window.selectionFixture.inspection.composer.text)).toBe(
      "Keep @owner\n\n> note.md\n> workspace · host remote\n> Selected\n",
    );
    expect(await page.evaluate(() => window.selectionFixture.inspection.composer.focusCount)).toBe(
      1,
    );
  });
}
for (const [width, theme] of [
  [390, "dark"],
  [1440, "light"],
] as const) {
  test(`selection menu stays themed and bounded at ${width}-${theme} without layout shift`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: Math.max(width, 1100), height: 1000 });
    await page.goto(`/tests/selection-preview.html?width=${width}&theme=${theme}`);
    const content = page.getByText("Selected prose.", { exact: true });
    await content.waitFor();
    const before = await content.boundingBox();
    await selectVisible(content);
    const button = page.getByRole("button", { name: "Add to chat" });
    await button.waitFor();
    expect(await content.boundingBox()).toEqual(before);
    const geometry = await button.evaluate((element) => {
      const menu = element.parentElement!.getBoundingClientRect();
      const reader = element.closest(".markdown-reader")!.getBoundingClientRect();
      return {
        inside:
          menu.left >= reader.left &&
          menu.right <= reader.right &&
          menu.top >= reader.top &&
          menu.bottom <= reader.bottom,
        overflow:
          element.closest(".markdown-reader")!.scrollWidth >
          element.closest(".markdown-reader")!.clientWidth,
      };
    });
    expect(geometry).toEqual({ inside: true, overflow: false });
    const color = await button.evaluate(
      (element) => getComputedStyle(element.parentElement!).backgroundColor,
    );
    await capture(page, info, `selection-${width}-${theme}`);
    await page.evaluate(() => (document.documentElement.dataset.theme = "custom"));
    expect(
      await button.evaluate((element) => getComputedStyle(element.parentElement!).backgroundColor),
    ).not.toBe(color);
    // Pointer focus changes must not discard the captured text.
    await button.click();
    expect(await page.evaluate(() => window.selectionFixture.inspection.composer.text)).toBe(
      "Keep @owner\n\n> note.md\n> workspace · host remote\n> Selected prose.\n",
    );
  });
}
test.describe("coarse pointer", () => {
  test.use({ hasTouch: true, isMobile: true });
  test("retains native selection without a custom menu", async ({ page }) => {
    await page.goto("/tests/selection-preview.html");
    const content = page.getByText("Selected prose.", { exact: true });
    await content.waitFor();
    await selectVisible(content);
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    expect(await page.evaluate(() => window.getSelection()!.toString())).toBe("Selected prose.");
    await expect(page.getByRole("button", { name: "Add to chat" })).toHaveCount(0);
  });
});

test("changing the file discards its old selection", async ({ page }) => {
  await page.goto("/tests/selection-preview.html");
  const content = page.getByText("Selected prose.", { exact: true });
  await content.waitFor();
  await selectVisible(content);
  await page.getByRole("button", { name: "Add to chat" }).waitFor();
  await page.evaluate(() => window.changeSelectionFile());
  await page.getByText("changed.md", { exact: true }).waitFor();
  await expect(page.getByRole("button", { name: "Add to chat" })).toHaveCount(0);
  expect(await page.evaluate(() => window.selectionFixture.inspection.composer.text)).toBe(
    "Keep @owner",
  );
});
