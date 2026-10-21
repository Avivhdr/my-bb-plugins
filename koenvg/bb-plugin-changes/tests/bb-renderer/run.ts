import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect, type Browser, type Page } from "@playwright/test";
import {
  DELETED_PATH,
  CONTEXT_PATH,
  RENAMED_PATH,
  RENAMED_TEXT,
  WORKSPACE_PATH,
  WORKSPACE_TEXT,
  loopbackOrigin,
  rendererFixture,
  unsupportedSlotBundle,
} from "./fixture";

type Plugin = {
  id: string;
  enabled: boolean;
  status: string;
  source: string;
  app: {
    hasApp: boolean;
    bundle: { jsUrl: string; cssUrl: string | null; compatible: boolean } | null;
  };
};
type PluginList = { plugins: Plugin[] };

const origin = loopbackOrigin(process.env.BB_RENDERER_URL ?? process.env.BB_SERVER_URL ?? "");
const threadId = process.env.BB_THREAD_ID;
const expectedEnvironment = process.env.BB_ENVIRONMENT_ID;
const evidence = process.env.BB_RENDERER_EVIDENCE;
if (!threadId || !expectedEnvironment || !evidence) {
  throw new Error(
    "Run in an owned BB thread with BB_THREAD_ID, BB_ENVIRONMENT_ID, and a new BB_RENDERER_EVIDENCE directory",
  );
}
await mkdir(resolve(evidence), { mode: 0o700 });
const evidenceDir = resolve(evidence);
const bundle = await readFile(new URL("../../dist/app.js", import.meta.url), "utf8");
const css = await readFile(new URL("../../dist/app.css", import.meta.url), "utf8");
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const checks: string[] = [];
const candidateTargets: { targetId: string; bundleSha256: string }[] = [];
const report: Record<string, unknown> = {
  origin,
  threadId,
  environmentId: expectedEnvironment,
  checkout: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  bundleSha256: hash(bundle),
  checks,
  browserExecutable: chromium.executablePath(),
  candidateTargets,
  boundaries:
    "Only the candidate frontend, other plugin frontend enablement, Changes RPC responses, and panel-tab persistence are page-local fixtures. BB supplies React, Pierre, native navigation, and actual workspace reads.",
};

async function json<T>(path: string): Promise<T> {
  const response = await fetch(origin + path, { signal: AbortSignal.timeout(10_000) });
  assert.equal(response.status, 200, `BB prerequisite failed: ${path}`);
  return response.json() as Promise<T>;
}
function installed(list: PluginList) {
  const plugin = list.plugins.find((item) => item.id === "changes");
  assert(
    plugin?.enabled && plugin.status === "running" && plugin.app.bundle?.compatible,
    "An enabled, compatible Changes plugin must already be running. This check never installs or reloads it.",
  );
  return {
    id: plugin.id,
    source: plugin.source,
    enabled: plugin.enabled,
    status: plugin.status,
    app: plugin.app,
  };
}
const before = installed(await json<PluginList>("/api/v1/plugins"));
const thread = await json<{ projectId: string; environmentId: string }>(
  `/api/v1/threads/${encodeURIComponent(threadId)}`,
);
assert.equal(
  thread.environmentId,
  expectedEnvironment,
  "The thread must use this run's owned environment",
);
const threadUrl = `${origin}/projects/${thread.projectId}/threads/${threadId}`;
report.installedBefore = before;
const tabsPath = `/api/v1/threads/${threadId}/tabs`;
const savedTabsBefore = await json<unknown>(tabsPath);
report.savedTabsBefore = savedTabsBefore;

async function candidate(browser: Browser, code: string) {
  const context = await browser.newContext({
    viewport: { width: 1800, height: 1100 },
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  const { targetInfo } = await session.send("Target.getTargetInfo");
  candidateTargets.push({ targetId: targetInfo.targetId, bundleSha256: hash(code) });
  await session.detach();
  const fixture = rendererFixture(threadId!, expectedEnvironment!);
  const unexpected: string[] = [];
  const fileReads: string[] = [];
  page.on("pageerror", (error) => unexpected.push(`Runtime error: ${error.message}`));
  let loads = 0;
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      url.origin === `http://127.0.0.1:${process.env.BB_HOST_DAEMON_PORT}` &&
      ["/status", "/workspace-open-targets"].includes(url.pathname) &&
      request.method() === "GET"
    ) {
      await route.continue();
    } else if (url.origin !== origin) {
      unexpected.push(`Cross-origin request: ${request.method()} ${url.origin}${url.pathname}`);
      await route.abort();
    } else if (url.pathname === "/api/v1/plugins") {
      const list = await json<PluginList>("/api/v1/plugins");
      for (const item of list.plugins) {
        if (item.id === "changes") {
          assert(item.app.bundle);
          item.app.bundle.jsUrl = "/__bbp215/candidate.js";
          item.app.bundle.cssUrl = "/__bbp215/candidate.css";
        } else if (item.app) item.app = { ...item.app, hasApp: false, bundle: null };
      }
      await route.fulfill({ json: list });
    } else if (url.pathname === "/__bbp215/candidate.js") {
      loads++;
      await route.fulfill({ contentType: "text/javascript", body: code });
    } else if (url.pathname === "/__bbp215/candidate.css") {
      await route.fulfill({ contentType: "text/css", body: css });
    } else if (url.pathname.startsWith("/api/v1/plugins/changes/rpc/")) {
      try {
        const result = await fixture.rpc(url.pathname.split("/").at(-1)!, request.postDataJSON());
        await route.fulfill({ json: { ok: true, result } });
      } catch (error) {
        unexpected.push(String(error));
        await route.abort();
      }
    } else if (url.pathname === `/api/v1/threads/${threadId}/tabs`) {
      await route.fulfill({
        json: fixture.tabs(
          request.method(),
          request.method() === "PUT" ? request.postDataJSON() : undefined,
        ),
      });
    } else if (!["GET", "HEAD"].includes(request.method())) {
      unexpected.push(`${request.method()} ${url.pathname}`);
      await route.abort();
    } else {
      const decoded = decodeURIComponent(url.pathname + url.search);
      if (decoded.includes(WORKSPACE_PATH) || decoded.includes(RENAMED_PATH))
        fileReads.push(url.pathname + url.search);
      await route.continue();
    }
  });
  await page.goto(threadUrl);
  await page.getByRole("button", { name: /^Show right panel/ }).click();
  await page.getByRole("button", { name: /^Open new tab/ }).click();
  await page.getByRole("button", { name: "Changes", exact: true }).click();
  const section = page.getByRole("region", { name: WORKSPACE_PATH, exact: true });
  await expect(section.locator("diffs-container")).toBeVisible();
  assert.equal(loads, 1, "This page must load exactly the current checkout's candidate bundle");
  return { page, context, fixture, unexpected, fileReads, section };
}

async function filenameControl(page: Page, path: string, timeout = 10_000) {
  const section = page.getByRole("region", { name: path, exact: true });
  const button = section.getByRole("button", { name: `Open ${path} in file viewer`, exact: true });
  await expect(button).toBeVisible({ timeout });
  return button;
}

let failure: Error | null = null;
const browser = await chromium.launch();
try {
  report.chromium = browser.version();
  const session = await browser.newBrowserCDPSession();
  const { processInfo } = await session.send("SystemInfo.getProcessInfo");
  report.browserPid = processInfo.find((process) => process.type === "browser")?.id;
  await session.detach();
  const good = await candidate(browser, bundle);
  const bad = await candidate(browser, unsupportedSlotBundle(bundle));
  try {
    const open = await filenameControl(good.page, WORKSPACE_PATH);
    await expect(
      good.section.getByRole("checkbox", { name: `Viewed ${WORKSPACE_PATH}`, exact: true }),
    ).not.toBeChecked();
    await good.section.screenshot({ path: resolve(evidenceDir, "filename-controls.png") });
    await expect(bad.section.locator("[data-diffs-header]")).toBeVisible();
    await expect(bad.section.locator("[data-title]")).toContainText("workspace.txt");
    let rejected = false;
    try {
      await filenameControl(bad.page, WORKSPACE_PATH, 1500);
    } catch {
      rejected = true;
    }
    assert(rejected, "The visibility gate accepted the unsupported filename slot");
    await expect(
      bad.section.getByRole("button", {
        name: `Open ${WORKSPACE_PATH} in file viewer`,
        exact: true,
      }),
    ).toHaveCount(0);
    checks.push(
      "The same filename-control visibility gate rejects an unsupported-slot candidate in a concurrent isolated context.",
    );
    await expect(open).toBeVisible();
    checks.push("The negative candidate does not replace the positive candidate's controls.");

    for (const action of ["mouse", "Enter", "Space"] as const) {
      if (action === "mouse") await open.click();
      else {
        await open.focus();
        await good.page.keyboard.press(action);
      }
      await expect(
        good.page
          .locator("[data-file-preview-scroll-container]")
          .getByText(WORKSPACE_TEXT, { exact: true }),
      ).toBeVisible();
      checks.push(`${action} opens actual current workspace content in BB's native file viewer.`);
      if (action === "mouse")
        await good.page
          .locator("[data-file-preview-scroll-container]")
          .getByText(WORKSPACE_TEXT, { exact: true })
          .screenshot({ path: resolve(evidenceDir, "native-file-content.png") });
      await good.page.getByRole("button", { name: "Changes", exact: true }).click();
      await expect(
        good.section.getByRole("button", {
          name: `Toggle diff for ${WORKSPACE_PATH}`,
          exact: true,
        }),
      ).toHaveAttribute("aria-expanded", "true");
      await expect(
        good.section.getByRole("checkbox", { name: `Viewed ${WORKSPACE_PATH}`, exact: true }),
      ).not.toBeChecked();
    }
    checks.push("Open-file activation preserves expanded and unviewed state.");
    const patchLine = good.section.getByText(
      "Historical patch content. This is not the live workspace file.",
      { exact: true },
    );
    await expect(patchLine).toBeVisible();
    const viewed = good.section.getByRole("checkbox", {
      name: `Viewed ${WORKSPACE_PATH}`,
      exact: true,
    });
    await viewed.check();
    await expect(
      good.section.getByRole("button", { name: `Expand ${WORKSPACE_PATH}`, exact: true }),
    ).toBeVisible();
    await expect(patchLine).not.toBeVisible();
    await open.click();
    await expect(
      good.page
        .locator("[data-file-preview-scroll-container]")
        .getByText(WORKSPACE_TEXT, { exact: true }),
    ).toBeVisible();
    await good.page.getByRole("button", { name: "Changes", exact: true }).click();
    await expect(viewed).toBeChecked();
    await expect(
      good.section.getByRole("button", { name: `Expand ${WORKSPACE_PATH}`, exact: true }),
    ).toBeVisible();
    await good.section
      .getByRole("button", { name: `Toggle diff for ${WORKSPACE_PATH}`, exact: true })
      .click();
    await expect(viewed).toBeChecked();
    await expect(
      good.section.getByRole("button", { name: `Collapse ${WORKSPACE_PATH}`, exact: true }),
    ).toBeVisible();
    await expect(patchLine).toBeVisible();
    await viewed.uncheck();
    checks.push(
      "Viewed collapses the real diff. Filename expansion preserves Viewed. Unchecking restores the diff.",
    );
    await good.page
      .getByRole("combobox", { name: "Diff target", exact: true })
      .selectOption("branch_committed");
    await expect
      .poll(
        () =>
          good.fixture.calls.filter((call) => call.method === "getChanges").at(-1)?.input.target,
      )
      .toEqual({ kind: "branch_committed" });
    await (await filenameControl(good.page, WORKSPACE_PATH)).click();
    await expect(
      good.page
        .locator("[data-file-preview-scroll-container]")
        .getByText(WORKSPACE_TEXT, { exact: true }),
    ).toBeVisible();
    await good.page.getByRole("button", { name: "Changes", exact: true }).click();
    checks.push("A historical diff target still opens the live workspace file, not patch content.");
    const deleted = await filenameControl(good.page, DELETED_PATH);
    await expect(deleted).toBeDisabled();
    await (await filenameControl(good.page, RENAMED_PATH)).click();
    await expect(
      good.page
        .locator("[data-file-preview-scroll-container]")
        .getByText(RENAMED_TEXT, { exact: true }),
    ).toBeVisible();
    checks.push(
      "Deleted-file activation is disabled. Renamed files open the current path and actual content.",
    );
    await good.page.getByRole("button", { name: "Changes", exact: true }).click();
    const contextSection = good.page.getByRole("region", { name: CONTEXT_PATH, exact: true });
    await contextSection.locator('[data-column-number="200"]').last().hover();
    await contextSection.locator("[data-utility-button]").click();
    await contextSection
      .getByRole("textbox", { name: "Comment", exact: true })
      .fill("Original diff comment survives context loading.");
    await contextSection.getByRole("button", { name: "Add to review", exact: true }).click();
    const existingComment = contextSection.getByText(
      "Original diff comment survives context loading.",
      { exact: true },
    );
    await expect(existingComment).toBeVisible();
    for (const view of ["Unified view", "Split view"] as const) {
      await good.page.getByRole("button", { name: view, exact: true }).click();
      await good.page.getByRole("button", { name: "Refresh", exact: true }).click();
      const load = contextSection.getByRole("button", { name: "Load context", exact: true });
      await expect(load).toBeEnabled();
      await expect(contextSection.locator("[data-expand-button]")).toHaveCount(0);
      good.fixture.failNextContext("read");
      await load.click();
      const retry = contextSection.getByRole("button", { name: "Retry context", exact: true });
      await expect(retry).toBeEnabled();
      await expect(contextSection.getByRole("status")).toHaveText("Could not load context. Retry.");
      await expect(contextSection.getByText("new value", { exact: true }).first()).toBeVisible();
      await retry.focus();
      await good.page.keyboard.press("Enter");
      await expect(contextSection.getByText("unchanged line 1", { exact: true })).toHaveCount(0);
      const above = contextSection
        .getByRole("button", { name: "Expand unchanged lines above", exact: true })
        .first();
      const below = contextSection
        .getByRole("button", { name: "Expand unchanged lines below", exact: true })
        .first();
      await expect(above).toBeVisible();
      await expect(below).toBeVisible();
      await expect(contextSection.getByText("unchanged line 198", { exact: true })).toHaveCount(0);
      await above.focus();
      await good.page.keyboard.press("Enter");
      await expect(
        contextSection.getByText("unchanged line 198", { exact: true }).first(),
      ).toBeVisible();
      await below.focus();
      await good.page.keyboard.press("Space");
      await expect(
        contextSection.getByText("unchanged line 202", { exact: true }).first(),
      ).toBeVisible();
      await above.click();
      await below.click();
      await expect(
        contextSection.getByText("unchanged line 1", { exact: true }).first(),
      ).toBeVisible();
      await expect(
        contextSection.getByText("unchanged line 400", { exact: true }).first(),
      ).toBeVisible();
      await contextSection.locator('[data-column-number="198"]').first().hover();
      await contextSection.locator("[data-utility-button]").click();
      await expect(existingComment).toBeVisible();
      await expect(
        good.page.getByRole("button", { name: "Send feedback (1)", exact: true }),
      ).toBeVisible();
      await expect(contextSection.getByRole("status")).toHaveText(
        "Revealed context is read-only. Comment on a line in the original diff.",
      );
      await expect(contextSection.getByRole("textbox", { name: "Comment" })).toHaveCount(0);
      await contextSection.getByText("new value", { exact: true }).first().scrollIntoViewIfNeeded();
      await good.page.screenshot({
        path: resolve(evidenceDir, `${view === "Unified view" ? "unified" : "split"}-context.png`),
      });
      const collapseLoaded = contextSection.getByRole("button", {
        name: `Collapse ${CONTEXT_PATH}`,
        exact: true,
      });
      await collapseLoaded.focus();
      await good.page.keyboard.press("Enter");
      const expandLoaded = contextSection.getByRole("button", {
        name: `Expand ${CONTEXT_PATH}`,
        exact: true,
      });
      await expect(expandLoaded).toBeFocused();
      await good.page.keyboard.press("Enter");
      await contextSection.getByRole("button", { name: "Load context", exact: true }).click();
      await expect(above).toBeVisible();
      const viewedLoaded = contextSection.getByRole("checkbox", {
        name: `Viewed ${CONTEXT_PATH}`,
        exact: true,
      });
      await viewedLoaded.focus();
      await good.page.keyboard.press("Space");
      await expect(viewedLoaded).toBeChecked();
      await expect(viewedLoaded).toBeFocused();
      await good.page.keyboard.press("Space");
      await expect(viewedLoaded).not.toBeChecked();
      await expect(existingComment).toBeVisible();
      checks.push(
        `${view} loads lazily, retains the partial diff on failure, retries with Enter, and expands native above/below controls using keyboard and pointer. Revealed lines refuse comments with visible feedback. Loaded-context Collapse and Viewed controls retain keyboard focus.`,
      );
    }
    await good.page.getByRole("button", { name: "Refresh", exact: true }).click();
    const loadContext = contextSection.getByRole("button", { name: "Load context", exact: true });
    await expect(loadContext).toBeEnabled();
    const release = good.fixture.deferNextContext();
    const previousCalls = good.fixture.calls.filter(
      (call) => call.method === "getTextContext",
    ).length;
    await loadContext.click();
    await expect
      .poll(() => good.fixture.calls.filter((call) => call.method === "getTextContext").length)
      .toBe(previousCalls + 1);
    await good.page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(loadContext).toBeEnabled();
    const lateResponse = good.page.waitForResponse((response) =>
      response.url().endsWith("/rpc/getTextContext"),
    );
    release();
    await lateResponse;
    await expect(contextSection.locator("[data-expand-button]")).toHaveCount(0);
    await expect(contextSection.getByText("new value", { exact: true }).first()).toBeVisible();
    good.fixture.failNextContext("stale");
    await loadContext.click();
    await expect(contextSection.getByRole("status")).toHaveText(
      "Context does not match this diff. Refresh changes.",
    );
    await expect(
      contextSection.getByRole("button", { name: "Load context", exact: true }),
    ).toBeDisabled();
    checks.push(
      "Refresh invalidates an in-flight context response. A stale snapshot retains the partial diff and asks for refresh.",
    );
    report.nativeFileReads = good.fileReads;
    report.rpcCalls = good.fixture.calls;
    assert(
      good.fileReads.includes(
        `/api/v1/environments/${expectedEnvironment}/files/${WORKSPACE_PATH}`,
      ),
      "Native file reads must target the thread environment and workspace path",
    );
    assert(
      good.fileReads.includes(`/api/v1/environments/${expectedEnvironment}/files/${RENAMED_PATH}`),
      "Renamed-file reads must use the current path in the thread environment",
    );
    assert.deepEqual(good.unexpected, []);
    assert.deepEqual(bad.unexpected, []);
    checks.push(
      "No unexpected mutation or sendFeedback reaches the server. Viewed writes remain page-local.",
    );
  } finally {
    await Promise.all([good.context.close(), bad.context.close()]);
  }
} catch (error) {
  report.error = String(error);
  failure = error instanceof Error ? error : new Error(String(error));
} finally {
  try {
    await browser.close();
    report.browserClosed = !browser.isConnected();
    report.installedAfter = installed(await json<PluginList>("/api/v1/plugins"));
    assert.deepEqual(
      report.installedAfter,
      report.installedBefore,
      "The installed plugin changed during verification. Nothing was restored or overwritten.",
    );
    report.savedTabsAfter = await json<unknown>(tabsPath);
    assert.deepEqual(
      report.savedTabsAfter,
      savedTabsBefore,
      "Saved panel tabs changed during verification. No user state was restored or overwritten.",
    );
    checks.push(
      "Owned contexts and browser closed. Installed Changes source, enabled state, status, bundle, and saved panel tabs remain unchanged.",
    );
  } catch (error) {
    report.cleanupError = String(error);
    failure ??= error instanceof Error ? error : new Error(String(error));
  } finally {
    report.status = report.error || report.cleanupError ? "failed" : "passed";
    await writeFile(resolve(evidenceDir, "report.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(`BB renderer evidence: ${evidenceDir}`);
  }
}
if (failure !== null) throw failure;
console.log(`Passed ${checks.length} BB renderer checks.`);
