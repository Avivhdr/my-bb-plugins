// @vitest-environment jsdom
import { pendingReviews } from "../core/pending-review";
import {
  textContextResultSchema,
  textRevisions,
  type Snapshot,
  type TextContextResult,
} from "../core/text-context";
import type { ImageWireResult } from "../core/image-content";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import type { ReactNode } from "react";
import {
  parsePatchFiles,
  type DiffLineAnnotation,
  type FileDiffMetadata,
  type SelectedLineRange,
} from "@pierre/diffs";
import { ReviewFileDiff } from "../../review-ui/review-file-diff";
import type { rpcContract } from "../contract";
import type {
  ChangedFile,
  ChangesResult,
  PatchesResult,
  SendFeedbackResult,
} from "../core/changes";
import { patchIdentity } from "../core/patch-identity";
import type { GetViewedResult, UpdateViewedResult } from "../core/viewed-files";
import { OUTLINE_WIDTH_KEY } from "./use-outline-width";

vi.mock("@pierre/diffs/react", () => ({
  FileDiff: ({
    fileDiff,
    options,
    lineAnnotations = [],
    renderAnnotation,
    renderHeaderPrefix,
    renderHeaderMetadata,
    renderCustomHeader,
  }: {
    fileDiff: FileDiffMetadata;
    options: {
      diffStyle?: string;
      collapsed?: boolean;
      onPostRender?: (node: HTMLElement) => void;
      stickyHeader?: boolean;
      overflow?: string;
      onGutterUtilityClick?: (range: SelectedLineRange) => void;
    };
    lineAnnotations?: DiffLineAnnotation<unknown>[];
    renderAnnotation?: (annotation: DiffLineAnnotation<unknown>) => ReactNode;
    renderHeaderPrefix?: () => ReactNode;
    renderHeaderMetadata?: () => ReactNode;
    renderCustomHeader?: () => ReactNode;
  }) => (
    <div
      ref={(element: HTMLDivElement | null) => {
        if (element === null) return;
        const root = element.shadowRoot ?? element.attachShadow({ mode: "open" });
        if (!root.firstChild && renderCustomHeader === undefined) {
          root.innerHTML = "<div data-diffs-header><div data-title></div></div>";
          root.querySelector("[data-title]")!.textContent = fileDiff.name;
        }
        options.onPostRender?.(element);
      }}
      data-testid="file-diff"
      data-path={fileDiff.name}
      data-additions={fileDiff.additionLines.join("")}
      data-diff-style={options.diffStyle}
      data-collapsed={String(options.collapsed ?? false)}
      data-sticky={String(options.stickyHeader)}
      data-overflow={options.overflow}
      data-header-mode={renderCustomHeader === undefined ? "default" : "custom"}
      data-prefix-renderer={String(renderHeaderPrefix !== undefined)}
      data-metadata-renderer={String(renderHeaderMetadata !== undefined)}
      data-partial={String(fileDiff.isPartial)}
    >
      {renderCustomHeader !== undefined ? (
        renderCustomHeader()
      ) : (
        <>
          {renderHeaderPrefix?.()}
          {fileDiff.prevName !== undefined && <span>{fileDiff.prevName}</span>}
          <span>{fileDiff.name}</span>
          {renderHeaderMetadata?.()}
        </>
      )}
      <pre aria-label="After contents">{fileDiff.additionLines.join("")}</pre>
      {(["additions", "deletions"] as const).flatMap((side) =>
        [1, 2, 3].map((line) => (
          <button
            key={`${side}${line}`}
            type="button"
            onClick={() => options.onGutterUtilityClick?.({ start: line, end: line, side })}
          >
            + {side} {line}
          </button>
        )),
      )}
      {lineAnnotations.map((annotation, index) => (
        <div
          key={index}
          data-testid="line-annotation"
          data-side={annotation.side}
          data-line={annotation.lineNumber}
        >
          {renderAnnotation?.(annotation)}
        </div>
      ))}
    </div>
  ),
}));

class VisibleAtOnce {
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe(target: Element) {
    this.callback(
      [{ isIntersecting: true, target } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
  disconnect() {}
}

beforeAll(() => {
  vi.stubGlobal("IntersectionObserver", VisibleAtOnce);
});

afterEach(cleanup);

const app = await loadPluginApp(() => import("../app"));
const changesTab = app.threadPanelActions.find((action) => action.id === "changes")!;

const PATCH_A =
  "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,3 +1,3 @@\n keep\n-old\n+new\n keep\n";
const PATCH_RENAME =
  "diff --git a/src/old.ts b/src/new.ts\nsimilarity index 90%\nrename from src/old.ts\nrename to src/new.ts\n--- a/src/old.ts\n+++ b/src/new.ts\n@@ -1 +1 @@\n-x\n+y\n";

const ALL_QUERY = { target: "all", mergeBaseBranch: "origin/main" } as const;

function file(path: string, overrides: Partial<ChangedFile> = {}): ChangedFile {
  return {
    path,
    previousPath: null,
    additions: 1,
    deletions: 1,
    binary: false,
    loadMode: "auto",
    status: "modified",
    ...overrides,
  };
}

function changes(
  files: ChangedFile[],
  extra: Partial<Extract<ChangesResult, { kind: "ok" }>> = {},
): ChangesResult {
  return {
    kind: "ok",
    environmentId: "env-1",
    imageBasis: null,
    query: ALL_QUERY,
    files,
    patches: {},
    commits: [],
    ...extra,
  };
}

const A_ONLY = changes([file("src/a.ts", { additions: 34, deletions: 5 })]);

let nextThread = 0;

interface Handlers {
  getVideo?: () =>
    | import("../core/video-content").VideoWireResult
    | Promise<import("../core/video-content").VideoWireResult>;
  getImage?: (input: { side: "before" | "after" }) => ImageWireResult | Promise<ImageWireResult>;
  getTextContext?: (
    input: Omit<Snapshot, "generation">,
  ) => TextContextResult | Promise<TextContextResult>;
  getChanges?: (input: unknown) => ChangesResult | Promise<ChangesResult>;
  getPatches?: (input: { paths: string[] }) => PatchesResult | Promise<PatchesResult>;
  sendFeedback?: (input: { text: string }) => SendFeedbackResult | Promise<SendFeedbackResult>;
  getViewed?: (input: { target: unknown }) => GetViewedResult | Promise<GetViewedResult>;
  updateViewed?: () => UpdateViewedResult | Promise<UpdateViewedResult>;
  openFilePreview?: () => boolean;
}

function renderTab(handlers: Handlers = {}, threadId = `thr_${++nextThread}`) {
  const slot = renderSlot<PluginThreadPanelProps, typeof rpcContract>(
    changesTab,
    { threadId, params: null },
    {
      openFilePreview: handlers.openFilePreview ?? (() => true),
      rpc: {
        getVideo:
          handlers.getVideo ?? (() => ({ kind: "error", code: "read", message: "unavailable" })),
        getTextContext:
          handlers.getTextContext ??
          (() => ({ kind: "error", code: "read", message: "Could not load context. Retry." })),
        getImage:
          handlers.getImage ?? (() => ({ kind: "error", code: "read", message: "unavailable" })),
        getChanges: handlers.getChanges ?? (() => A_ONLY),
        getPatches:
          handlers.getPatches ??
          (({ paths }) => ({
            kind: "ok",
            patches: Object.fromEntries(
              paths.map((path) => [path, path === "src/new.ts" ? PATCH_RENAME : PATCH_A]),
            ),
          })),
        sendFeedback: handlers.sendFeedback ?? (() => ({ kind: "sent", delivery: "sent" })),
        getViewed: handlers.getViewed ?? (() => ({ kind: "ok", marks: {} })),
        updateViewed: handlers.updateViewed ?? (() => ({ kind: "ok" })),
      },
    },
  );
  return Object.assign(slot, { threadId });
}

describe("Changes raster review", () => {
  const imageBasis = {
    environmentId: "env-1",
    headSha: "1111111111111111111111111111111111111111",
    mergeBaseRef: "2222222222222222222222222222222222222222",
    target: { kind: "all" as const },
  };
  it.each(["mp4", "webm"])(
    "keeps an LFS %s pointer on the text review route with existing comments and Viewed",
    async (extension) => {
      const path = `clip.${extension}`;
      const threadId = `thr_lfs_${extension}`;
      const patch = `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,3 +1,3 @@\n version https://git-lfs.github.com/spec/v1\n-oid sha256:${"1".repeat(64)}\n+oid sha256:${"2".repeat(64)}\n-size 10000000\n+size 10000001\n`;
      pendingReviews.addComment(
        threadId,
        { path, side: "additions", line: 2 },
        "Keep the LFS object tracked",
      );
      const slot = renderTab(
        {
          getChanges: () => changes([file(path)], { patches: { [path]: patch }, imageBasis }),
        },
        threadId,
      );
      const diff = await slot.findByTestId("file-diff");
      expect(diff.getAttribute("data-additions")).toContain(
        "version https://git-lfs.github.com/spec/v1",
      );
      expect(diff.getAttribute("data-additions")).toContain("size 10000001");
      const card = slot.getByRole("article", { name: "Pending comment" });
      expect(within(card).getByText("Keep the LFS object tracked")).toBeTruthy();
      expect(card.closest("[data-testid=line-annotation]")?.getAttribute("data-line")).toBe("2");
      expect(slot.queryByRole("button", { name: /Load (before|after) video/ })).toBeNull();
      expect(callsTo(slot, "getVideo")).toEqual([]);
      const viewed = slot.getByRole("checkbox", { name: `Viewed ${path}` }) as HTMLInputElement;
      fireEvent.click(viewed);
      await waitFor(() => expect(viewed.checked).toBe(true));
    },
  );
  it("loads video only on request, preserves navigation and unloads at refresh", async () => {
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:changes-video");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const play = vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue("probably");
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const slot = renderTab({
      getChanges: () =>
        changes([file("clip.mp4", { binary: true, status: "added" })], { imageBasis }),
      getVideo: () => ({
        kind: "ready",
        content: "AAAAAGZ0eXBpc29t",
        mime: "video/mp4",
        sizeBytes: 12,
      }),
    });
    await slot.findByRole("button", { name: "Load after video" });
    expect(slot.getByText("Not present")).toBeTruthy();
    expect(callsTo(slot, "getVideo")).toEqual([]);
    expect(callsTo(slot, "getImage")).toEqual([]);
    expect(callsTo(slot, "getPatches")).toEqual([]);
    fireEvent.click(slot.getByRole("button", { name: "Load after video" }));
    const video = (await slot.findByLabelText(
      "After: clip.mp4 (Live working tree (at read time))",
    )) as HTMLVideoElement;
    expect(video.controls).toBe(true);
    expect(video.autoplay).toBe(false);
    expect(callsTo(slot, "getVideo")).toMatchObject([
      { side: "after", file: { path: "clip.mp4" }, basis: imageBasis },
    ]);
    fireEvent.click(slot.getByRole("button", { name: "Open clip.mp4 in file viewer" }));
    fireEvent.click(slot.getByRole("button", { name: "Refresh" }));
    await slot.findByRole("button", { name: "Load after video" });
    expect(revoke).toHaveBeenCalledWith("blob:changes-video");
    expect(pause).toHaveBeenCalled();
    expect(callsTo(slot, "getVideo")).toHaveLength(1);
    create.mockRestore();
    revoke.mockRestore();
    play.mockRestore();
    pause.mockRestore();
  });
  it("shows added image absence, preserves open-file navigation and releases at refresh start", async () => {
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:changes");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    let finish: ((result: ChangesResult) => void) | undefined;
    let count = 0;
    const value = changes([file("logo.png", { binary: true, status: "added" })], { imageBasis });
    const slot = renderTab({
      getChanges: () =>
        ++count === 1
          ? value
          : new Promise((resolve) => {
              finish = resolve;
            }),
      getImage: () => ({
        kind: "ready",
        content: "iVBORw0KGgoAAAAA",
        mime: "image/png",
        sizeBytes: 12,
      }),
    });
    await slot.findByRole("img", { name: "After: logo.png (Live working tree (at read time))" });
    expect(slot.getByText("Not present")).toBeTruthy();
    expect(callsTo(slot, "getImage")).toHaveLength(1);
    expect(callsTo(slot, "getPatches")).toEqual([]);
    expect(slot.queryByRole("checkbox")).toBeNull();
    fireEvent.click(slot.getByRole("button", { name: "Open logo.png in file viewer" }));
    fireEvent.click(slot.getByRole("button", { name: "Refresh" }));
    expect(slot.queryByRole("img", { name: /^After:/ })).toBeNull();
    expect(revoke).toHaveBeenCalledWith("blob:changes");
    await act(async () => finish?.(value));
    await slot.findByRole("img", { name: "After: logo.png (Live working tree (at read time))" });
    fireEvent.click(slot.getByRole("button", { name: "Collapse logo.png" }));
    expect(slot.queryByRole("img", { name: /^After:/ })).toBeNull();
    expect(callsTo(slot, "getImage")).toHaveLength(2);
    create.mockRestore();
    revoke.mockRestore();
  });
  it("keeps SVG on the text diff route", async () => {
    const patch = PATCH_A.replaceAll("src/a.ts", "icon.svg");
    const slot = renderTab({
      getChanges: () => changes([file("icon.svg")], { patches: { "icon.svg": patch }, imageBasis }),
    });
    await slot.findByTestId("file-diff");
    expect(callsTo(slot, "getImage")).toEqual([]);
    expect(slot.getByRole("checkbox", { name: "Viewed icon.svg" })).toBeTruthy();
  });
});

type Slot = ReturnType<typeof renderTab>;

function callsTo(slot: Slot, method: string) {
  return slot.inspection.rpcCalls
    .filter((call) => call.method === method)
    .map((call) => call.input);
}

async function addComment(slot: Slot, button: string, text: string) {
  fireEvent.click(await slot.findByRole("button", { name: button }));
  fireEvent.change(slot.getByRole("textbox", { name: "Comment" }), { target: { value: text } });
  fireEvent.click(slot.getByRole("button", { name: "Add to review" }));
}

describe("Changes tab", () => {
  it("is a flush thread panel action named Changes, not offered on root compose", () => {
    expect(changesTab).toMatchObject({ title: "Changes", layout: "flush" });
    expect(app.newThreadPanelActions ?? []).toEqual([]);
  });

  it("loads all changes of its thread and shows the summary", async () => {
    const slot = renderTab();

    await waitFor(() =>
      expect(slot.getByTestId("diff-summary").textContent).toBe("1 file+34-50/1 viewed"),
    );
    expect((slot.getByRole("combobox", { name: "Diff target" }) as HTMLSelectElement).value).toBe(
      "all",
    );
    expect(callsTo(slot, "getChanges")).toEqual([
      { threadId: slot.threadId, target: { kind: "all" } },
    ]);
  });

  it("sums the counts of all files", async () => {
    const slot = renderTab({
      getChanges: () =>
        changes([
          file("a.ts", { additions: 30, deletions: 4 }),
          file("b.ts", { additions: 4, deletions: 1 }),
        ]),
    });

    await waitFor(() =>
      expect(slot.getByTestId("diff-summary").textContent).toBe("2 files+34-50/2 viewed"),
    );
  });

  it("shows the file sections folders first, then files, by name", async () => {
    const slot = renderTab({
      getChanges: () => changes([file("README.md"), file("src/b.ts"), file("src/ui/a.ts")]),
    });

    await slot.findAllByTestId("file-diff");
    const sections = slot.getAllByRole("region");

    expect(sections.map((section) => section.getAttribute("aria-label"))).toEqual([
      "src/ui/a.ts",
      "src/b.ts",
      "README.md",
    ]);
  });

  it("shows Binary file and Diff too large instead of a diff", async () => {
    const slot = renderTab({
      getChanges: () =>
        changes([
          file("archive.bin", { binary: true }),
          file("big.json", { loadMode: "too_large" }),
        ]),
    });

    expect(await slot.findByText("Binary file")).toBeTruthy();
    expect(slot.getByText("Diff too large")).toBeTruthy();
    expect(callsTo(slot, "getPatches")).toEqual([]);
  });

  it("loads the patch of a file that comes into view", async () => {
    const slot = renderTab({
      getChanges: () =>
        changes([file("src/new.ts", { previousPath: "src/old.ts", loadMode: "on_demand" })]),
    });

    const diff = await slot.findByTestId("file-diff");

    expect(diff.dataset.path).toBe("src/new.ts");
    expect(within(diff).getByText("src/old.ts")).toBeTruthy();
    expect(callsTo(slot, "getPatches")).toEqual([
      { threadId: slot.threadId, query: ALL_QUERY, paths: ["src/new.ts"] },
    ]);
  });

  it("loads the patches of files that come into view together in one call", async () => {
    const slot = renderTab({ getChanges: () => changes([file("src/a.ts"), file("src/b.ts")]) });

    await waitFor(() => expect(slot.getAllByTestId("file-diff")).toHaveLength(2));

    expect(callsTo(slot, "getPatches")).toEqual([
      { threadId: slot.threadId, query: ALL_QUERY, paths: ["src/a.ts", "src/b.ts"] },
    ]);
  });

  it("keeps showing a diff while its refreshed patch loads", async () => {
    let patchCalls = 0;
    const slot = renderTab({
      getPatches: ({ paths }) =>
        patchCalls++ === 0
          ? { kind: "ok", patches: Object.fromEntries(paths.map((path) => [path, PATCH_A])) }
          : new Promise<PatchesResult>(() => {}),
    });
    await slot.findByTestId("file-diff");

    fireEvent.click(slot.getByRole("button", { name: "Refresh" }));

    await waitFor(() => expect(patchCalls).toBe(2));
    expect(slot.getByTestId("file-diff")).toBeTruthy();
    expect(slot.queryByText("Loading diff…")).toBeNull();
  });

  it("uses an initial patch without asking for it again", async () => {
    const slot = renderTab({
      getChanges: () => changes([file("src/a.ts")], { patches: { "src/a.ts": PATCH_A } }),
    });

    await slot.findByTestId("file-diff");

    expect(callsTo(slot, "getPatches")).toEqual([]);
  });

  it("loads one commit when the user picks it", async () => {
    const slot = renderTab({
      getChanges: () =>
        changes([file("src/a.ts")], {
          commits: [{ sha: "abc1234def", shortSha: "abc1234", subject: "feat: a" }],
        }),
    });
    const picker = await slot.findByRole("combobox", { name: "Diff target" });
    await slot.findByRole("option", { name: "abc1234 feat: a" });

    fireEvent.change(picker, { target: { value: "commit:abc1234def" } });

    await waitFor(() =>
      expect(callsTo(slot, "getChanges").at(-1)).toEqual({
        threadId: slot.threadId,
        target: { kind: "commit", sha: "abc1234def" },
      }),
    );
  });

  it("switches every file to split view", async () => {
    const slot = renderTab();
    expect((await slot.findByTestId("file-diff")).dataset.diffStyle).toBe("unified");

    fireEvent.click(slot.getByRole("button", { name: "Split view" }));

    expect(slot.getByTestId("file-diff").dataset.diffStyle).toBe("split");
  });

  it("keeps the last diff visible while a refresh runs", async () => {
    let release: (result: ChangesResult) => void = () => {};
    let call = 0;
    const slot = renderTab({
      getChanges: () =>
        call++ === 0 ? A_ONLY : new Promise<ChangesResult>((resolve) => (release = resolve)),
    });
    await slot.findByTestId("file-diff");

    fireEvent.click(slot.getByRole("button", { name: "Refresh" }));

    expect(await slot.findByRole("button", { name: "Refreshing…" })).toBeTruthy();
    expect(slot.getByTestId("file-diff")).toBeTruthy();
    await act(async () => release(changes([])));
    expect(await slot.findByText("No changes")).toBeTruthy();
  });

  it("shows a load error with a retry button", async () => {
    let call = 0;
    const slot = renderTab({
      getChanges: () => (call++ === 0 ? { kind: "error", message: "permission denied" } : A_ONLY),
    });

    expect(await slot.findByText("permission denied")).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Retry" }));

    expect(await slot.findByTestId("file-diff")).toBeTruthy();
    expect(callsTo(slot, "getChanges")).toHaveLength(2);
  });

  it("tells the user when the thread has no git repository", async () => {
    const slot = renderTab({ getChanges: () => ({ kind: "no_git" }) });

    expect(await slot.findByText("No git repository for this thread")).toBeTruthy();
  });
});

describe("shared diff header", () => {
  const fileDiff = parsePatchFiles(PATCH_A, undefined, true)[0]!.files[0]!;

  it("renders only custom content and keeps sticky, wrap, and controlled collapse", () => {
    const screen = render(
      <ReviewFileDiff
        fileDiff={fileDiff}
        annotations={[]}
        renderAnnotation={() => null}
        view="split"
        theme={{ name: "github-dark", mode: "dark" }}
        collapsed
        customHeader={<span>Changes-owned header</span>}
        headerPrefix={<span>Default prefix</span>}
        headerMetadata={<span>Default metadata</span>}
      />,
    );
    const diff = screen.getByTestId("file-diff");
    expect(diff.textContent).toBe(
      "Changes-owned headerkeep\nnew\nkeep\n+ additions 1+ additions 2+ additions 3+ deletions 1+ deletions 2+ deletions 3",
    );
    expect(diff.dataset).toMatchObject({
      headerMode: "custom",
      prefixRenderer: "false",
      metadataRenderer: "false",
      sticky: "true",
      overflow: "wrap",
      collapsed: "true",
      diffStyle: "split",
    });
  });

  it.each([undefined, null])(
    "keeps the GitHub-style default header for customHeader=%s",
    (customHeader) => {
      const screen = render(
        <ReviewFileDiff
          fileDiff={fileDiff}
          annotations={[]}
          renderAnnotation={() => null}
          view="unified"
          theme={{ name: "github-light", mode: "light" }}
          customHeader={customHeader}
          headerPrefix={<button type="button">Collapse src/a.ts</button>}
          headerMetadata={
            <label>
              <input type="checkbox" aria-label="Viewed src/a.ts" />
              Viewed
            </label>
          }
        />,
      );
      const diff = screen.getByTestId("file-diff");
      expect(
        screen.getByRole("button", { name: "Collapse src/a.ts" }).nextElementSibling?.textContent,
      ).toBe("src/a.ts");
      expect(
        screen.getByRole("checkbox", { name: "Viewed src/a.ts" }).parentElement?.textContent,
      ).toBe("Viewed");
      expect(diff.dataset).toMatchObject({
        headerMode: "default",
        prefixRenderer: "true",
        metadataRenderer: "true",
        sticky: "true",
        overflow: "wrap",
        collapsed: "false",
      });
    },
  );
});

describe("open file", () => {
  it("opens the thread workspace file beside its filename without changing collapse or Viewed", async () => {
    const slot = renderTab({}, "thr_preview");
    const diff = await slot.findByTestId("file-diff");
    const button = within(diff).getByRole("button", { name: "Open src/a.ts in file viewer" });
    expect(button.previousElementSibling?.textContent).toBe("src/a.ts");
    expect(button.previousElementSibling?.getAttribute("title")).toBe("src/a.ts");
    expect(diff.dataset.headerMode).toBe("custom");
    expect(diff.dataset.prefixRenderer).toBe("false");
    expect(diff.dataset.metadataRenderer).toBe("false");
    expect(button.nextElementSibling?.textContent).toBe("+34-5Viewed");
    expect(
      Array.from(diff.querySelectorAll('button, input[type="checkbox"]'))
        .slice(0, 4)
        .map((control) => control.getAttribute("aria-label")),
    ).toEqual([
      "Collapse src/a.ts",
      "Toggle diff for src/a.ts",
      "Open src/a.ts in file viewer",
      "Viewed src/a.ts",
    ]);
    expect(within(diff).getByRole("img", { name: "modified file" }).getAttribute("title")).toBe(
      "modified file",
    );
    expect(button.title).toBe("Open src/a.ts in file viewer");

    fireEvent.click(button);

    expect(slot.inspection.navigateCalls).toEqual([
      {
        method: "experimental_openFilePreview",
        options: {
          target: { kind: "workspace", environmentId: "env-1", path: "src/a.ts" },
          location: null,
        },
      },
    ]);
    expect(diff.dataset.collapsed).toBe("false");
    expect(
      (slot.getByRole("checkbox", { name: "Viewed src/a.ts" }) as HTMLInputElement).checked,
    ).toBe(false);
    expect(slot.queryByRole("alert")).toBeNull();
    expect(callsTo(slot, "getChanges")).toEqual([
      { threadId: "thr_preview", target: { kind: "all" } },
    ]);
    expect(callsTo(slot, "updateViewed")).toEqual([]);
  });

  it("accepts a focused native button activation with no pointer detail", async () => {
    const slot = renderTab();
    const diff = await slot.findByTestId("file-diff");
    const button = within(diff).getByRole("button", { name: "Open src/a.ts in file viewer" });
    button.focus();
    expect(document.activeElement).toBe(button);
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");

    const bubbledKeys: string[] = [];
    const onKeyDown = (event: KeyboardEvent) =>
      bubbledKeys.push((event.target as HTMLElement).tagName);
    document.addEventListener("keydown", onKeyDown);
    try {
      fireEvent.keyDown(button, { key: "Enter" });
      fireEvent.click(button, { detail: 0 });
      fireEvent.keyDown(slot.getByRole("checkbox", { name: "Viewed src/a.ts" }), { key: "Enter" });
    } finally {
      document.removeEventListener("keydown", onKeyDown);
    }
    expect(bubbledKeys).toEqual(["INPUT"]);

    expect(slot.inspection.navigateCalls).toEqual([
      {
        method: "experimental_openFilePreview",
        options: {
          target: { kind: "workspace", environmentId: "env-1", path: "src/a.ts" },
          location: null,
        },
      },
    ]);
  });

  it("opens a renamed file's current path, including from a historical diff", async () => {
    const slot = renderTab({
      getChanges: (input) =>
        changes([file("src/new.ts", { previousPath: "src/old.ts", status: "renamed" })], {
          query:
            (input as { target: { kind: string } }).target.kind === "commit"
              ? { target: "commit", sha: "abc1234def" }
              : ALL_QUERY,
          commits: [{ sha: "abc1234def", shortSha: "abc1234", subject: "rename file" }],
          patches: { "src/new.ts": PATCH_RENAME },
        }),
    });
    await slot.findByTestId("file-diff");
    fireEvent.change(slot.getByRole("combobox", { name: "Diff target" }), {
      target: { value: "commit:abc1234def" },
    });
    await waitFor(() =>
      expect(callsTo(slot, "getViewed").at(-1)).toEqual({
        threadId: slot.threadId,
        target: { kind: "commit", sha: "abc1234def" },
      }),
    );

    const open = slot.getByRole("button", { name: "Open src/new.ts in file viewer" });
    expect(open.previousElementSibling?.textContent).toBe("src/old.ts → src/new.ts");
    expect(open.previousElementSibling?.getAttribute("title")).toBe("src/old.ts → src/new.ts");
    expect(open.previousElementSibling?.querySelectorAll("bdi").length).toBe(2);
    fireEvent.click(open);

    expect(slot.inspection.navigateCalls).toEqual([
      {
        method: "experimental_openFilePreview",
        options: {
          target: { kind: "workspace", environmentId: "env-1", path: "src/new.ts" },
          location: null,
        },
      },
    ]);
  });

  it("uses the environment returned for this thread, not the ambient context", async () => {
    const slot = renderTab({
      getChanges: () => changes([file("src/a.ts")], { environmentId: "env-thread-2" }),
    });
    await slot.findByTestId("file-diff");

    fireEvent.click(slot.getByRole("button", { name: "Open src/a.ts in file viewer" }));

    expect(slot.inspection.navigateCalls).toEqual([
      {
        method: "experimental_openFilePreview",
        options: {
          target: { kind: "workspace", environmentId: "env-thread-2", path: "src/a.ts" },
          location: null,
        },
      },
    ]);
  });

  it("opens a collapsed viewed file without expanding it or changing its mark", async () => {
    const slot = renderTab({
      getChanges: () => changes([file("src/a.ts")], { patches: { "src/a.ts": PATCH_A } }),
      getViewed: () => ({ kind: "ok", marks: { "src/a.ts": patchIdentity(PATCH_A) } }),
    });
    const diff = await slot.findByTestId("file-diff");
    await waitFor(() => expect(diff.dataset.collapsed).toBe("true"));
    const open = within(diff).getByRole("button", { name: "Open src/a.ts in file viewer" });
    expect(open.previousElementSibling?.textContent).toBe("src/a.ts");
    expect(open.nextElementSibling?.textContent).toBe("+1-1Viewed");

    fireEvent.click(open);

    expect(slot.inspection.navigateCalls).toEqual([
      {
        method: "experimental_openFilePreview",
        options: {
          target: { kind: "workspace", environmentId: "env-1", path: "src/a.ts" },
          location: null,
        },
      },
    ]);
    expect(diff.dataset.collapsed).toBe("true");
    expect(
      (slot.getByRole("checkbox", { name: "Viewed src/a.ts" }) as HTMLInputElement).checked,
    ).toBe(true);
    expect(slot.getByTestId("diff-summary").textContent).toBe("1 file+1-11/1 viewed");
    expect(callsTo(slot, "updateViewed")).toEqual([]);
  });

  it.each([
    ["Binary file", { binary: true }, undefined],
    ["Diff too large", { loadMode: "too_large" }, undefined],
    ["Loading diff…", {}, () => new Promise<PatchesResult>(() => {})],
    ["patch denied", {}, () => ({ kind: "error", message: "patch denied" })],
    ["Diff not available", {}, () => ({ kind: "ok", patches: { "src/a.ts": "not a patch" } })],
  ] satisfies [string, Partial<ChangedFile>, Handlers["getPatches"]][])(
    "opens the live file from the %s notice",
    async (notice, overrides, getPatches) => {
      const slot = renderTab({
        getChanges: () => changes([file("src/a.ts", overrides)]),
        getPatches,
      });
      const text = await slot.findByText(notice);
      expect(text.textContent).toBe(notice);

      const open = slot.getByRole("button", { name: "Open src/a.ts in file viewer" });
      expect(open.previousElementSibling?.textContent).toBe("src/a.ts");
      expect(open.nextElementSibling?.textContent).toBe("+1-1");
      fireEvent.click(open);

      expect(slot.inspection.navigateCalls).toEqual([
        {
          method: "experimental_openFilePreview",
          options: {
            target: { kind: "workspace", environmentId: "env-1", path: "src/a.ts" },
            location: null,
          },
        },
      ]);
    },
  );

  it.each([
    ["Binary file", { binary: true }, undefined],
    ["Diff too large", { loadMode: "too_large" }, undefined],
    ["Loading diff…", {}, () => new Promise<PatchesResult>(() => {})],
    ["patch denied", {}, () => ({ kind: "error", message: "patch denied" })],
    ["Diff not available", {}, () => ({ kind: "ok", patches: { "src/new.ts": "not a patch" } })],
  ] satisfies [string, Partial<ChangedFile>, Handlers["getPatches"]][])(
    "keeps rename context and trailing preview in the %s notice",
    async (notice, overrides, getPatches) => {
      const slot = renderTab({
        getChanges: () =>
          changes([
            file("src/new.ts", { ...overrides, previousPath: "src/old.ts", status: "renamed" }),
          ]),
        getPatches,
      });
      expect((await slot.findByText(notice)).textContent).toBe(notice);
      const open = slot.getByRole("button", { name: "Open src/new.ts in file viewer" });
      expect(open.previousElementSibling?.textContent).toBe("src/old.ts → src/new.ts");
      expect(open.previousElementSibling?.getAttribute("title")).toBe("src/old.ts → src/new.ts");
      expect(open.previousElementSibling?.querySelectorAll("bdi").length).toBe(2);
      fireEvent.click(open);
      expect(slot.inspection.navigateCalls).toEqual([
        {
          method: "experimental_openFilePreview",
          options: {
            target: { kind: "workspace", environmentId: "env-1", path: "src/new.ts" },
            location: null,
          },
        },
      ]);
    },
  );

  it.each([false, true])(
    "disables deleted files in diff and notice headers, binary=%s",
    async (binary) => {
      const slot = renderTab({
        getChanges: () =>
          changes([
            file("src/deleted.ts", { status: "deleted", binary }),
            file("src/new.ts", { previousPath: "src/old.ts", status: "renamed" }),
          ]),
      });
      await slot.findAllByTestId("file-diff");
      const deleted = slot.getByRole("button", {
        name: "Open src/deleted.ts in file viewer",
      }) as HTMLButtonElement;
      expect(deleted.disabled).toBe(true);
      expect(deleted.title).toBe("Deleted files cannot be opened in the live workspace");
      fireEvent.click(deleted);
      fireEvent.click(slot.getByRole("button", { name: "Open src/new.ts in file viewer" }));

      expect(slot.inspection.navigateCalls).toEqual([
        {
          method: "experimental_openFilePreview",
          options: {
            target: { kind: "workspace", environmentId: "env-1", path: "src/new.ts" },
            location: null,
          },
        },
      ]);
    },
  );

  it("reports a rejected preview intent and clears feedback after acceptance", async () => {
    let accepted = false;
    const slot = renderTab({ openFilePreview: () => accepted });
    await slot.findByTestId("file-diff");
    const button = slot.getByRole("button", { name: "Open src/a.ts in file viewer" });

    fireEvent.click(button);

    expect(slot.getByRole("alert").textContent).toBe("Could not open src/a.ts in file viewer");
    expect(slot.inspection.navigateCalls).toEqual([
      {
        method: "experimental_openFilePreview",
        options: {
          target: { kind: "workspace", environmentId: "env-1", path: "src/a.ts" },
          location: null,
        },
      },
    ]);
    accepted = true;
    fireEvent.click(button);
    expect(slot.queryByRole("alert")).toBeNull();
    expect(slot.inspection.navigateCalls).toEqual([
      {
        method: "experimental_openFilePreview",
        options: {
          target: { kind: "workspace", environmentId: "env-1", path: "src/a.ts" },
          location: null,
        },
      },
      {
        method: "experimental_openFilePreview",
        options: {
          target: { kind: "workspace", environmentId: "env-1", path: "src/a.ts" },
          location: null,
        },
      },
    ]);
  });

  it("shows feedback if the preview host throws", async () => {
    const slot = renderTab({
      openFilePreview: () => {
        throw new Error("viewer unavailable");
      },
    });
    await slot.findByTestId("file-diff");

    fireEvent.click(slot.getByRole("button", { name: "Open src/a.ts in file viewer" }));

    expect(slot.getByRole("alert").textContent).toBe("Could not open src/a.ts in file viewer");
    expect(slot.inspection.navigateCalls).toEqual([
      {
        method: "experimental_openFilePreview",
        options: {
          target: { kind: "workspace", environmentId: "env-1", path: "src/a.ts" },
          location: null,
        },
      },
    ]);
  });
});

describe("inline comments", () => {
  it("opens a new-side form from the + on an added line", async () => {
    const slot = renderTab();

    fireEvent.click(await slot.findByRole("button", { name: "+ additions 2" }));

    const annotation = slot.getByTestId("line-annotation");
    expect(annotation.dataset).toMatchObject({ side: "additions", line: "2" });
    expect(within(annotation).getByRole("textbox", { name: "Comment" })).toBeTruthy();
  });

  it("opens an old-side form from the + on a deleted line", async () => {
    const slot = renderTab();

    fireEvent.click(await slot.findByRole("button", { name: "+ deletions 2" }));

    expect(slot.getByTestId("line-annotation").dataset).toMatchObject({
      side: "deletions",
      line: "2",
    });
  });

  it("puts a comment on a context line clicked in the old column on the new side", async () => {
    const slot = renderTab();

    fireEvent.click(await slot.findByRole("button", { name: "+ deletions 3" }));

    expect(slot.getByTestId("line-annotation").dataset).toMatchObject({
      side: "additions",
      line: "3",
    });
  });

  it("shows an open form whose line left the diff under Not in this diff", async () => {
    let call = 0;
    const slot = renderTab({
      getChanges: () => (call++ === 0 ? A_ONLY : changes([file("src/b.ts")])),
    });
    fireEvent.click(await slot.findByRole("button", { name: "+ additions 2" }));
    fireEvent.change(slot.getByRole("textbox", { name: "Comment" }), {
      target: { value: "keep me" },
    });

    fireEvent.click(slot.getByRole("button", { name: "Refresh" }));

    const section = await slot.findByRole("region", { name: "Not in this diff" });
    expect(
      (within(section).getByRole("textbox", { name: "Comment" }) as HTMLTextAreaElement).value,
    ).toBe("keep me");
  });

  it("opens only one form per line and side", async () => {
    const slot = renderTab();
    const plus = await slot.findByRole("button", { name: "+ additions 2" });

    fireEvent.click(plus);
    fireEvent.click(plus);

    expect(slot.getAllByRole("textbox", { name: "Comment" })).toHaveLength(1);
  });

  it("keeps the form text after the tab unmounts and mounts again", async () => {
    const first = renderTab();
    fireEvent.click(await first.findByRole("button", { name: "+ additions 2" }));
    fireEvent.change(first.getByRole("textbox", { name: "Comment" }), {
      target: { value: "half a thought" },
    });
    first.unmount();

    const again = renderTab({}, first.threadId);

    expect(
      ((await again.findByRole("textbox", { name: "Comment" })) as HTMLTextAreaElement).value,
    ).toBe("half a thought");
  });

  it("disables Add to review while the text is blank", async () => {
    const slot = renderTab();
    fireEvent.click(await slot.findByRole("button", { name: "+ additions 2" }));

    fireEvent.change(slot.getByRole("textbox", { name: "Comment" }), { target: { value: "   " } });

    expect(
      (slot.getByRole("button", { name: "Add to review" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("adds the comment below its line and counts it", async () => {
    const slot = renderTab();

    await addComment(slot, "+ additions 2", "Null check missing");

    const card = slot.getByRole("article", { name: "Pending comment" });
    expect(within(card).getByText("Null check missing")).toBeTruthy();
    expect(slot.queryByRole("textbox", { name: "Comment" })).toBeNull();
    expect(slot.getByRole("button", { name: "Send feedback (1)" })).toBeTruthy();
  });

  it("adds the comment with Cmd+Enter", async () => {
    const slot = renderTab();
    fireEvent.click(await slot.findByRole("button", { name: "+ additions 2" }));
    const box = slot.getByRole("textbox", { name: "Comment" });
    fireEvent.change(box, { target: { value: "Typo" } });

    fireEvent.keyDown(box, { key: "Enter", metaKey: true });

    expect(slot.getByRole("button", { name: "Send feedback (1)" })).toBeTruthy();
  });

  it("cancels the form with Escape without adding a comment", async () => {
    const slot = renderTab();
    fireEvent.click(await slot.findByRole("button", { name: "+ additions 2" }));
    const box = slot.getByRole("textbox", { name: "Comment" });
    fireEvent.change(box, { target: { value: "never mind" } });

    fireEvent.keyDown(box, { key: "Escape" });

    expect(slot.queryByRole("textbox", { name: "Comment" })).toBeNull();
    expect(slot.getByRole("button", { name: "Send feedback (0)" })).toBeTruthy();
  });

  it("removes a pending comment", async () => {
    const slot = renderTab();
    await addComment(slot, "+ additions 2", "one");
    await addComment(slot, "+ additions 3", "two");

    fireEvent.click(
      within(slot.getAllByRole("article", { name: "Pending comment" })[0]!).getByRole("button", {
        name: "Remove",
      }),
    );

    expect(slot.getAllByRole("article", { name: "Pending comment" })).toHaveLength(1);
    expect(slot.getByRole("button", { name: "Send feedback (1)" })).toBeTruthy();
  });

  it("keeps pending comments per thread", async () => {
    const first = renderTab();
    await addComment(first, "+ additions 2", "for thread one");
    first.unmount();

    const other = renderTab();
    expect(await other.findByRole("button", { name: "Send feedback (0)" })).toBeTruthy();
    other.unmount();

    const back = renderTab({}, first.threadId);
    expect(await back.findByRole("button", { name: "Send feedback (1)" })).toBeTruthy();
  });

  it("moves a comment whose line left the diff to Not in this diff", async () => {
    let call = 0;
    const slot = renderTab({
      getChanges: () => (call++ === 0 ? A_ONLY : changes([file("src/b.ts")])),
    });
    await addComment(slot, "+ additions 2", "Null check missing");

    fireEvent.click(slot.getByRole("button", { name: "Refresh" }));

    const section = await slot.findByRole("region", { name: "Not in this diff" });
    expect(within(section).getByText("src/a.ts:2")).toBeTruthy();
    expect(within(section).getByText("Null check missing")).toBeTruthy();
    expect(slot.getByRole("button", { name: "Send feedback (1)" })).toBeTruthy();
  });
});

describe("send feedback", () => {
  it("is disabled with no pending comments", async () => {
    const slot = renderTab();

    expect(
      ((await slot.findByRole("button", { name: "Send feedback (0)" })) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("sends the edited prompt and clears the sent comments", async () => {
    const slot = renderTab();
    await addComment(slot, "+ additions 2", "Null check missing");
    await addComment(slot, "+ deletions 2", "Why remove this?");
    fireEvent.click(slot.getByRole("button", { name: "Send feedback (2)" }));
    const prompt = (await slot.findByRole("textbox", {
      name: "Review prompt",
    })) as HTMLTextAreaElement;
    expect(prompt.value).toContain(
      "1. `src/a.ts:2` - Null check missing\n2. `src/a.ts:2 (deleted line)` - Why remove this?",
    );

    fireEvent.change(prompt, { target: { value: `${prompt.value}\nAlso run the tests.` } });
    fireEvent.click(slot.getByRole("button", { name: "Send to agent" }));

    expect(await slot.findByText("Sent to agent")).toBeTruthy();
    expect((callsTo(slot, "sendFeedback")[0] as { text: string }).text).toMatch(
      /Also run the tests\.$/,
    );
    expect(slot.queryByRole("article", { name: "Pending comment" })).toBeNull();
    expect(slot.getByRole("button", { name: "Send feedback (0)" })).toBeTruthy();
  });

  it("says when the message waits for the agent", async () => {
    const slot = renderTab({ sendFeedback: () => ({ kind: "sent", delivery: "queued" }) });
    await addComment(slot, "+ additions 2", "x");
    fireEvent.click(slot.getByRole("button", { name: "Send feedback (1)" }));

    fireEvent.click(await slot.findByRole("button", { name: "Send to agent" }));

    expect(await slot.findByText("Queued until the agent is idle")).toBeTruthy();
  });

  it("keeps the dialog and all comments when the send fails", async () => {
    const slot = renderTab({ sendFeedback: () => ({ kind: "error", message: "thread archived" }) });
    await addComment(slot, "+ additions 2", "x");
    fireEvent.click(slot.getByRole("button", { name: "Send feedback (1)" }));

    fireEvent.click(await slot.findByRole("button", { name: "Send to agent" }));

    expect(await slot.findByRole("alert")).toHaveProperty("textContent", "thread archived");
    expect(slot.getByRole("textbox", { name: "Review prompt" })).toBeTruthy();
    expect(slot.getByRole("button", { name: "Send feedback (1)", hidden: true })).toBeTruthy();
  });

  it("drops prompt edits and keeps the comments on Cancel", async () => {
    const slot = renderTab();
    await addComment(slot, "+ additions 2", "x");
    fireEvent.click(slot.getByRole("button", { name: "Send feedback (1)" }));
    fireEvent.change(await slot.findByRole("textbox", { name: "Review prompt" }), {
      target: { value: "edited" },
    });

    fireEvent.click(slot.getByRole("button", { name: "Cancel" }));
    fireEvent.click(slot.getByRole("button", { name: "Send feedback (1)" }));

    expect(
      ((await slot.findByRole("textbox", { name: "Review prompt" })) as HTMLTextAreaElement).value,
    ).toContain("`src/a.ts:2` - x");
    expect(callsTo(slot, "sendFeedback")).toEqual([]);
  });
});

describe("Viewed files", () => {
  const PATCH_B = PATCH_A.replace("+new", "+newer");
  const A_LOADED = changes([file("src/a.ts")], { patches: { "src/a.ts": PATCH_A } });
  const VIEWED_A: GetViewedResult = { kind: "ok", marks: { "src/a.ts": patchIdentity(PATCH_A) } };

  function diffOf(slot: Slot, path = "src/a.ts") {
    return slot.getAllByTestId("file-diff").find((diff) => diff.dataset.path === path)!;
  }

  function checkbox(slot: Slot, path = "src/a.ts") {
    return slot.getByRole("checkbox", { name: `Viewed ${path}` }) as HTMLInputElement;
  }

  async function viewedTab(handlers: Handlers = {}, threadId?: string) {
    const slot = renderTab(
      { getChanges: () => A_LOADED, getViewed: () => VIEWED_A, ...handlers },
      threadId,
    );
    await waitFor(() => expect(checkbox(slot).checked).toBe(true));
    return slot;
  }

  it("collapses a file and saves its patch identity when the user checks Viewed", async () => {
    const slot = renderTab({ getChanges: () => A_LOADED });
    await waitFor(() => expect(checkbox(slot).disabled).toBe(false));

    fireEvent.click(checkbox(slot));

    expect(diffOf(slot).dataset.collapsed).toBe("true");
    expect(slot.getByTestId("diff-summary").textContent).toContain("1/1 viewed");
    expect(callsTo(slot, "updateViewed")).toEqual([
      {
        threadId: slot.threadId,
        target: { kind: "all" },
        set: { "src/a.ts": patchIdentity(PATCH_A) },
        remove: [],
      },
    ]);
  });

  it("shows a stored mark collapsed and expands the file when the user unchecks Viewed", async () => {
    const slot = await viewedTab();
    expect(diffOf(slot).dataset.collapsed).toBe("true");

    fireEvent.click(checkbox(slot));

    expect(diffOf(slot).dataset.collapsed).toBe("false");
    expect(callsTo(slot, "updateViewed")).toEqual([
      { threadId: slot.threadId, target: { kind: "all" }, set: {}, remove: ["src/a.ts"] },
    ]);
  });

  it("has no Viewed checkbox and no counter for binary and too large files", async () => {
    const slot = renderTab({
      getChanges: () =>
        changes([
          file("archive.bin", { binary: true }),
          file("big.json", { loadMode: "too_large" }),
        ]),
    });

    await slot.findByText("Binary file");
    await waitFor(() => expect(callsTo(slot, "getViewed")).toHaveLength(1));

    expect(slot.queryByRole("checkbox")).toBeNull();
    expect(slot.getByTestId("diff-summary").textContent).not.toContain("viewed");
  });

  it("expands a viewed file without a change to the mark or the counter", async () => {
    const slot = await viewedTab();

    fireEvent.click(slot.getByRole("button", { name: "Expand src/a.ts" }));

    expect(diffOf(slot).dataset.collapsed).toBe("false");
    expect(checkbox(slot).checked).toBe(true);
    expect(slot.getByTestId("diff-summary").textContent).toContain("1/1 viewed");
    expect(callsTo(slot, "updateViewed")).toEqual([]);
  });

  it("toggles only the clicked filename's accordion and keeps Viewed controls independent", async () => {
    const patchB = PATCH_A.replaceAll("src/a.ts", "src/b.ts");
    const slot = renderTab({
      getChanges: () =>
        changes([file("src/a.ts"), file("src/b.ts")], {
          patches: { "src/a.ts": PATCH_A, "src/b.ts": patchB },
        }),
    });
    await waitFor(() => expect(checkbox(slot).disabled).toBe(false));
    const filename = within(diffOf(slot)).getByRole("button", { name: "Toggle diff for src/a.ts" });
    expect(filename.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(filename);
    expect(diffOf(slot).dataset.collapsed).toBe("true");
    expect(diffOf(slot, "src/b.ts").dataset.collapsed).toBe("false");
    expect(checkbox(slot).checked).toBe(false);
    expect(slot.getByTestId("diff-summary").textContent).toContain("0/2 viewed");
    expect(callsTo(slot, "updateViewed")).toEqual([]);

    fireEvent.click(filename);
    expect(diffOf(slot).dataset.collapsed).toBe("false");
    fireEvent.click(checkbox(slot));
    expect(diffOf(slot).dataset.collapsed).toBe("true");
    expect(checkbox(slot).checked).toBe(true);
    fireEvent.click(filename);
    expect(diffOf(slot).dataset.collapsed).toBe("false");
    expect(checkbox(slot).checked).toBe(true);
    expect(slot.getByTestId("diff-summary").textContent).toContain("1/2 viewed");
    fireEvent.click(slot.getByRole("button", { name: "Collapse src/a.ts" }));
    expect(diffOf(slot).dataset.collapsed).toBe("true");
  });

  it("collapses a file that is not viewed and keeps it not viewed", async () => {
    const slot = renderTab({ getChanges: () => A_LOADED });
    await waitFor(() => expect(checkbox(slot).disabled).toBe(false));

    fireEvent.click(slot.getByRole("button", { name: "Collapse src/a.ts" }));

    expect(diffOf(slot).dataset.collapsed).toBe("true");
    expect(checkbox(slot).checked).toBe(false);
  });

  it("collapses an expanded viewed file again when the user unchecks and checks Viewed", async () => {
    const slot = await viewedTab();
    fireEvent.click(slot.getByRole("button", { name: "Expand src/a.ts" }));

    fireEvent.click(checkbox(slot));
    fireEvent.click(checkbox(slot));

    expect(diffOf(slot).dataset.collapsed).toBe("true");
  });

  it("keeps an expanded viewed file expanded after the tab unmounts and mounts again", async () => {
    const first = await viewedTab();
    fireEvent.click(first.getByRole("button", { name: "Expand src/a.ts" }));
    first.unmount();

    const second = renderTab({ getChanges: () => A_LOADED }, first.threadId);

    await waitFor(() => expect(checkbox(second).checked).toBe(true));
    expect(diffOf(second).dataset.collapsed).toBe("false");
  });

  it("drops the mark and expands the file when its patch changes", async () => {
    let load = 0;
    const slot = await viewedTab({
      getChanges: () =>
        changes([file("src/a.ts")], { patches: { "src/a.ts": load++ === 0 ? PATCH_A : PATCH_B } }),
    });
    fireEvent.click(slot.getByRole("button", { name: "Expand src/a.ts" }));
    fireEvent.click(slot.getByRole("button", { name: "Collapse src/a.ts" }));

    fireEvent.click(slot.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      expect(checkbox(slot).checked).toBe(false);
      expect(diffOf(slot).dataset.collapsed).toBe("false");
      expect(slot.getByTestId("diff-summary").textContent).toContain("0/1 viewed");
      expect(callsTo(slot, "updateViewed")).toEqual([
        { threadId: slot.threadId, target: { kind: "all" }, set: {}, remove: ["src/a.ts"] },
      ]);
    });
  });

  it("drops the mark of a file that left the diff", async () => {
    const slot = renderTab({
      getChanges: () => A_LOADED,
      getViewed: () => ({ kind: "ok", marks: { "src/gone.ts": patchIdentity(PATCH_A) } }),
    });

    await waitFor(() =>
      expect(callsTo(slot, "updateViewed")).toEqual([
        { threadId: slot.threadId, target: { kind: "all" }, set: {}, remove: ["src/gone.ts"] },
      ]),
    );
  });

  it("keeps the marks when a refresh fails", async () => {
    let load = 0;
    const slot = await viewedTab({
      getChanges: () => (load++ === 0 ? A_LOADED : { kind: "error", message: "permission denied" }),
    });

    fireEvent.click(slot.getByRole("button", { name: "Refresh" }));

    await slot.findByText("permission denied");
    expect(callsTo(slot, "updateViewed")).toEqual([]);
  });

  it("keeps marks per diff target", async () => {
    const slot = await viewedTab({
      getChanges: (input) =>
        (input as { target: { kind: string } }).target.kind === "uncommitted"
          ? { ...A_LOADED, query: { target: "uncommitted" } }
          : A_LOADED,
      getViewed: ({ target }) =>
        (target as { kind: string }).kind === "all" ? VIEWED_A : { kind: "ok", marks: {} },
    });

    fireEvent.change(slot.getByRole("combobox", { name: "Diff target" }), {
      target: { value: "uncommitted" },
    });

    await waitFor(() =>
      expect(callsTo(slot, "getViewed")).toContainEqual({
        threadId: slot.threadId,
        target: { kind: "uncommitted" },
      }),
    );
    await waitFor(() => expect(checkbox(slot).checked).toBe(false));
  });

  it("puts the checkbox back and shows the error when the save fails", async () => {
    const slot = renderTab({
      getChanges: () => A_LOADED,
      updateViewed: () => ({ kind: "error", message: "disk full" }),
    });
    await waitFor(() => expect(checkbox(slot).disabled).toBe(false));

    fireEvent.click(checkbox(slot));

    expect(await slot.findByText("Could not save viewed state: disk full")).toBeTruthy();
    expect(checkbox(slot).checked).toBe(false);
    expect(diffOf(slot).dataset.collapsed).toBe("false");
  });
});

describe("file outline", () => {
  function outline(slot: Slot) {
    return within(slot.getByRole("navigation", { name: "Files" }));
  }

  async function addCommentIn(slot: Slot, path: string, button: string, text: string) {
    const section = await slot.findByRole("region", { name: path });
    fireEvent.click(await within(section).findByRole("button", { name: button }));
    fireEvent.change(slot.getByRole("textbox", { name: "Comment" }), { target: { value: text } });
    fireEvent.click(slot.getByRole("button", { name: "Add to review" }));
  }

  it("shows folder rows and file rows with counts, pending comments, and the full path as tooltip", async () => {
    const slot = renderTab({
      getChanges: () =>
        changes([
          file("src/b.ts", { additions: 2, deletions: 0 }),
          file("src/a.ts", { additions: 12, deletions: 3 }),
        ]),
    });
    await addCommentIn(slot, "src/a.ts", "+ additions 1", "one");
    await addCommentIn(slot, "src/a.ts", "+ additions 2", "two");

    const files = outline(slot);
    const rowA = files.getByRole("button", { name: /a\.ts/ });

    expect(files.getByText("src")).toBeTruthy();
    expect(rowA.title).toBe("src/a.ts");
    expect(rowA.textContent).toBe("a.ts22 pending commentsM+12-3");
    expect(files.getByRole("button", { name: /b\.ts/ }).textContent).toBe("b.tsM+2-0");
  });

  it.each([
    ["added", "A", "Added"],
    ["modified", "M", "Modified"],
    ["deleted", "D", "Deleted"],
    ["renamed", "R", "Renamed"],
    ["copied", "C", "Copied"],
    ["type_changed", "T", "Type changed"],
    ["untracked", "U", "Untracked"],
  ] as const)("shows a %s file with the badge %s", async (status, letter, label) => {
    const slot = renderTab({ getChanges: () => changes([file("src/a.ts", { status })]) });
    await slot.findAllByTestId("file-diff");

    expect(outline(slot).getByRole("img", { name: label }).textContent).toBe(letter);
  });

  it("shows a file-type icon per file and the generic icon for an unknown type", async () => {
    const slot = renderTab({ getChanges: () => changes([file("src/a.ts"), file("notes.xyz")]) });
    await slot.findAllByTestId("file-diff");
    const files = outline(slot);

    expect(
      files
        .getByRole("button", { name: /^a\.ts/ })
        .querySelector("[data-icon]")
        ?.getAttribute("data-icon"),
    ).toBe("typescript");
    expect(
      files
        .getByRole("button", { name: /^notes\.xyz/ })
        .querySelector("[data-icon]")
        ?.getAttribute("data-icon"),
    ).toBe("file");
  });

  it("shows the parts of a merged folder and one indent guide per level", async () => {
    const slot = renderTab({
      getChanges: () =>
        changes([file("src/ui/lib/a.ts"), file("src/ui/lib/b.ts"), file("src/d.ts")]),
    });
    await slot.findAllByTestId("file-diff");
    const files = outline(slot);

    expect(files.getByRole("button", { name: "src" })).toBeTruthy();
    const lib = files.getByRole("button", { name: "ui/lib" });
    expect(within(lib).getByText("ui")).toBeTruthy();
    expect(within(lib).getByText("lib")).toBeTruthy();
    expect(
      files
        .getByRole("button", { name: /^a\.ts/ })
        .closest("li")!
        .querySelectorAll("[data-indent-guide]"),
    ).toHaveLength(2);
  });

  it("folds and unfolds a folder without changing the diff sections", async () => {
    const slot = renderTab({
      getChanges: () => changes([file("src/a.ts"), file("src/b.ts"), file("README.md")]),
    });
    await slot.findAllByTestId("file-diff");
    const files = outline(slot);
    const folder = files.getByRole("button", { name: "src" });

    fireEvent.click(folder);

    expect(folder.getAttribute("aria-expanded")).toBe("false");
    expect(files.queryByRole("button", { name: /^a\.ts/ })).toBeNull();
    expect(files.getByRole("button", { name: /^README\.md/ })).toBeTruthy();
    expect(slot.getAllByRole("region")).toHaveLength(3);

    fireEvent.click(folder);

    expect(folder.getAttribute("aria-expanded")).toBe("true");
    expect(files.getByRole("button", { name: /^a\.ts/ })).toBeTruthy();
  });

  it("opens all folders again when the diff target changes", async () => {
    let call = 0;
    const slot = renderTab({
      getChanges: () =>
        call++ === 0 ? changes([file("src/a.ts")]) : changes([file("src/a.ts"), file("src/b.ts")]),
    });
    await slot.findAllByTestId("file-diff");
    fireEvent.click(outline(slot).getByRole("button", { name: "src" }));

    fireEvent.change(slot.getByRole("combobox", { name: "Diff target" }), {
      target: { value: "uncommitted" },
    });

    await waitFor(() => expect(outline(slot).getByRole("button", { name: /^b\.ts/ })).toBeTruthy());
    expect(outline(slot).getByRole("button", { name: "src" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("keeps folders folded after a refresh", async () => {
    const slot = renderTab({ getChanges: () => changes([file("src/a.ts"), file("README.md")]) });
    await slot.findAllByTestId("file-diff");
    fireEvent.click(outline(slot).getByRole("button", { name: "src" }));

    fireEvent.click(slot.getByRole("button", { name: "Refresh" }));

    await waitFor(() => expect(callsTo(slot, "getChanges")).toHaveLength(2));
    expect(outline(slot).getByRole("button", { name: "src" }).getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("marks no row when the current file is in a folded folder", async () => {
    const slot = renderTab({ getChanges: () => changes([file("src/a.ts"), file("README.md")]) });
    await slot.findAllByTestId("file-diff");
    await waitFor(() =>
      expect(
        outline(slot)
          .getByRole("button", { name: /^a\.ts/ })
          .getAttribute("aria-current"),
      ).toBe("true"),
    );

    fireEvent.click(outline(slot).getByRole("button", { name: "src" }));

    expect(
      slot.getByRole("navigation", { name: "Files" }).querySelector("[aria-current]"),
    ).toBeNull();
  });

  it.each([
    ["while loading", () => new Promise<ChangesResult>(() => {})],
    ["on a load error", () => ({ kind: "error", message: "boom" }) as ChangesResult],
    ["without a git repository", () => ({ kind: "no_git" }) as ChangesResult],
    ["when nothing changed", () => changes([])],
  ])("shows no outline %s", async (_, getChanges) => {
    const slot = renderTab({ getChanges });

    await act(async () => {});

    expect(slot.queryByRole("navigation", { name: "Files" })).toBeNull();
  });

  describe("resize handle", () => {
    beforeEach(() => {
      localStorage.clear();
      Element.prototype.setPointerCapture = vi.fn();
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
        this: HTMLElement,
      ) {
        const width = parseFloat(this.style.width) || 0;
        return {
          top: 0,
          bottom: 0,
          height: 0,
          left: 0,
          right: width,
          width,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        };
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
      delete (Element.prototype as Partial<Element>).setPointerCapture;
    });

    async function renderHandle() {
      const slot = renderTab({ getChanges: () => changes([file("a.ts")]) });
      await slot.findAllByTestId("file-diff");
      const handle = slot.getByRole("separator", { name: "Resize file outline" });
      return { slot, handle, width: () => Number(handle.getAttribute("aria-valuenow")) };
    }

    function drag(handle: HTMLElement, from: number, to: number) {
      fireEvent.pointerDown(handle, { clientX: from, pointerId: 1, button: 0 });
      fireEvent.pointerMove(handle, { clientX: to, pointerId: 1 });
      fireEvent.pointerUp(handle, { clientX: to, pointerId: 1 });
    }

    it("starts at 320px", async () => {
      const { slot, width } = await renderHandle();

      expect(width()).toBe(320);
      expect(slot.getByRole("navigation", { name: "Files" }).parentElement!.style.width).toBe(
        "320px",
      );
    });

    it("drags wider and saves the width on release", async () => {
      const { handle, width } = await renderHandle();

      fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1, button: 0 });
      fireEvent.pointerMove(handle, { clientX: 600, pointerId: 1 });

      expect(width()).toBe(420);
      expect(localStorage.getItem(OUTLINE_WIDTH_KEY)).toBeNull();

      fireEvent.pointerUp(handle, { clientX: 600, pointerId: 1 });

      expect(localStorage.getItem(OUTLINE_WIDTH_KEY)).toBe("420");
    });

    it("stops at 520px", async () => {
      const { handle, width } = await renderHandle();

      drag(handle, 500, 880);

      expect(width()).toBe(520);
    });

    it("ignores pointer moves without a drag", async () => {
      const { handle, width } = await renderHandle();

      fireEvent.pointerMove(handle, { clientX: 900, pointerId: 1 });

      expect(width()).toBe(320);
    });

    it("resets to 320px on double-click", async () => {
      const { handle, width } = await renderHandle();
      drag(handle, 500, 600);

      fireEvent.doubleClick(handle);

      expect(width()).toBe(320);
      expect(localStorage.getItem(OUTLINE_WIDTH_KEY)).toBeNull();
    });

    it("moves 10px per arrow key", async () => {
      const { handle, width } = await renderHandle();

      fireEvent.keyDown(handle, { key: "ArrowRight" });
      expect(width()).toBe(330);

      fireEvent.keyDown(handle, { key: "ArrowLeft" });
      fireEvent.keyDown(handle, { key: "ArrowLeft" });
      expect(width()).toBe(310);
      expect(localStorage.getItem(OUTLINE_WIDTH_KEY)).toBe("310");
    });

    it("starts the arrow keys from the width on screen", async () => {
      const { handle, width } = await renderHandle();
      vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(() => ({
        top: 0,
        bottom: 0,
        height: 0,
        left: 0,
        right: 368,
        width: 368,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }));

      fireEvent.keyDown(handle, { key: "ArrowLeft" });

      expect(width()).toBe(358);
    });

    it("ends the drag when the pointer capture is lost", async () => {
      const { handle, width } = await renderHandle();
      fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1, button: 0 });
      fireEvent.pointerMove(handle, { clientX: 550, pointerId: 1 });

      fireEvent.lostPointerCapture(handle, { pointerId: 1 });
      fireEvent.pointerMove(handle, { clientX: 900, pointerId: 1 });

      expect(width()).toBe(370);
      expect(localStorage.getItem(OUTLINE_WIDTH_KEY)).toBe("370");
    });

    it("opens with the saved width", async () => {
      localStorage.setItem(OUTLINE_WIDTH_KEY, "400");

      const { width } = await renderHandle();

      expect(width()).toBe(400);
    });
  });

  describe("navigation", () => {
    const heights = new Map<string, number>();
    const AREA_TOP = 50;
    const AREA_HEIGHT = 400;
    const ROW_HEIGHT = 30;
    const NAV_HEIGHT = 60;
    let resizeCallbacks: ResizeObserverCallback[] = [];

    class FakeResizeObserver {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe() {
        resizeCallbacks.push(this.callback);
      }
      disconnect() {
        resizeCallbacks = resizeCallbacks.filter((callback) => callback !== this.callback);
      }
    }

    function rect(top: number, height: number): DOMRect {
      return {
        top,
        bottom: top + height,
        height,
        left: 0,
        right: 0,
        width: 0,
        x: 0,
        y: top,
        toJSON: () => ({}),
      };
    }

    function layOut(sizes: Record<string, number>) {
      for (const [path, height] of Object.entries(sizes)) heights.set(path, height);
    }

    function resize() {
      act(() => {
        for (const callback of resizeCallbacks) callback([], {} as ResizeObserver);
      });
    }

    beforeEach(() => {
      heights.clear();
      resizeCallbacks = [];
      vi.stubGlobal("ResizeObserver", FakeResizeObserver);
      Element.prototype.scrollIntoView = vi.fn();
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
        this: HTMLElement,
      ) {
        const area = this.closest<HTMLElement>("[data-diff-scroll-area]");
        if (this.matches("[data-diff-scroll-area]")) return rect(AREA_TOP, AREA_HEIGHT);
        if (area !== null && this.matches("section[data-path]")) {
          let top = AREA_TOP - area.scrollTop;
          for (const section of Array.from(
            area.querySelectorAll<HTMLElement>("section[data-path]"),
          )) {
            if (section === this) break;
            top += heights.get(section.dataset.path!) ?? 0;
          }
          return rect(top, heights.get(this.dataset.path!) ?? 0);
        }
        const nav = this.closest<HTMLElement>("nav");
        if (this.tagName === "NAV") return rect(0, NAV_HEIGHT);
        if (nav !== null && this.tagName === "BUTTON") {
          const index = Array.from(nav.querySelectorAll("li")).indexOf(this.closest("li")!);
          return rect(index * ROW_HEIGHT - nav.scrollTop, ROW_HEIGHT);
        }
        return rect(0, 0);
      });
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    });

    async function renderFiles(paths: string[]) {
      const slot = renderTab({ getChanges: () => changes(paths.map((path) => file(path))) });
      await slot.findAllByTestId("file-diff");
      layOut(Object.fromEntries(paths.map((path) => [path, 500])));
      const area = slot.container.querySelector<HTMLElement>("[data-diff-scroll-area]")!;
      return Object.assign(slot, { area });
    }

    function row(slot: Slot, name: string) {
      return outline(slot).getByRole("button", {
        name: new RegExp(`^${name.replace(".", "\\.")}`),
      });
    }

    it("scrolls the clicked file to the top of the diff", async () => {
      const slot = await renderFiles(["a.ts", "b.ts", "c.ts"]);

      fireEvent.click(row(slot, "c.ts"));

      expect(slot.area.scrollTop).toBe(1000);
    });

    it("keeps the clicked file at the top while diffs above it change height", async () => {
      const slot = await renderFiles(["a.ts", "b.ts", "c.ts"]);
      fireEvent.click(row(slot, "c.ts"));

      layOut({ "b.ts": 800 });
      resize();

      expect(slot.area.scrollTop).toBe(1300);
    });

    it("stops holding the clicked file when the user scrolls", async () => {
      const slot = await renderFiles(["a.ts", "b.ts", "c.ts"]);
      fireEvent.click(row(slot, "c.ts"));

      fireEvent.wheel(slot.area);
      layOut({ "b.ts": 800 });
      resize();

      expect(slot.area.scrollTop).toBe(1000);
    });

    it("stops holding the clicked file one second after the last height change", async () => {
      const slot = await renderFiles(["a.ts", "b.ts", "c.ts"]);
      vi.useFakeTimers();
      fireEvent.click(row(slot, "c.ts"));

      vi.advanceTimersByTime(1000);
      layOut({ "b.ts": 800 });
      resize();

      expect(slot.area.scrollTop).toBe(1000);
    });

    it("stops holding the clicked file when the diff target changes", async () => {
      let call = 0;
      const slot = renderTab({
        getChanges: () =>
          call++ === 0
            ? changes(["a.ts", "b.ts", "c.ts"].map((path) => file(path)))
            : changes([file("a.ts")]),
      });
      await slot.findAllByTestId("file-diff");
      layOut({ "a.ts": 500, "b.ts": 500, "c.ts": 500 });
      const area = slot.container.querySelector<HTMLElement>("[data-diff-scroll-area]")!;
      fireEvent.click(row(slot, "c.ts"));

      fireEvent.change(slot.getByRole("combobox", { name: "Diff target" }), {
        target: { value: "uncommitted" },
      });
      await waitFor(() => expect(slot.getAllByRole("region")).toHaveLength(1));
      resize();

      expect(area.scrollTop).toBe(1000);
    });

    it("stops holding the clicked file on a key press anywhere", async () => {
      const slot = await renderFiles(["a.ts", "b.ts", "c.ts"]);
      fireEvent.click(row(slot, "c.ts"));

      fireEvent.keyDown(document.body, { key: "PageDown" });
      layOut({ "b.ts": 800 });
      resize();

      expect(slot.area.scrollTop).toBe(1000);
    });

    it("does not scroll the diff when a folder row is clicked", async () => {
      const slot = await renderFiles(["lib/a.ts", "src/b.ts", "src/c.ts"]);

      fireEvent.click(outline(slot).getByRole("button", { name: "src" }));

      expect(slot.area.scrollTop).toBe(0);
    });

    it("still jumps to a file outside a folded folder", async () => {
      const slot = await renderFiles(["lib/a.ts", "src/b.ts", "c.ts"]);
      fireEvent.click(outline(slot).getByRole("button", { name: "lib" }));

      fireEvent.click(row(slot, "c.ts"));

      expect(slot.area.scrollTop).toBe(1000);
      expect(row(slot, "c.ts").getAttribute("aria-current")).toBe("true");
    });

    it("marks the file at the top of the diff and follows the scroll", async () => {
      const slot = await renderFiles(["a.ts", "b.ts", "c.ts"]);

      expect(row(slot, "a.ts").getAttribute("aria-current")).toBe("true");

      slot.area.scrollTop = 600;
      fireEvent.scroll(slot.area);

      await waitFor(() => expect(row(slot, "b.ts").getAttribute("aria-current")).toBe("true"));
      expect(row(slot, "a.ts").getAttribute("aria-current")).toBeNull();
    });

    it("marks the clicked file at once", async () => {
      const slot = await renderFiles(["a.ts", "b.ts", "c.ts"]);

      fireEvent.click(row(slot, "c.ts"));

      expect(row(slot, "c.ts").getAttribute("aria-current")).toBe("true");
    });

    it("scrolls the outline to the marked row only when the row is out of view", async () => {
      const slot = await renderFiles(["a.ts", "b.ts", "c.ts", "d.ts"]);

      fireEvent.click(row(slot, "b.ts"));
      expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();

      fireEvent.click(row(slot, "d.ts"));
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
      expect(vi.mocked(Element.prototype.scrollIntoView).mock.contexts[0]).toBe(row(slot, "d.ts"));
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    });
  });
});

describe("Changes text context", () => {
  const imageBasis = {
    environmentId: "env-1",
    headSha: "a".repeat(40),
    mergeBaseRef: "b".repeat(40),
    target: { kind: "all" as const },
  };
  const patch =
    "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -2 +2 @@\n-old\n+new\n";
  const value = changes([file("src/a.ts")], { imageBasis, patches: { "src/a.ts": patch } });
  function ready(input: Omit<Snapshot, "generation">) {
    const revisions = textRevisions(input.basis, input.file);
    return textContextResultSchema.parse({
      kind: "ready",
      old: {
        kind: "text",
        revision: revisions.old,
        contents: "prefix\nold\nsuffix\n",
        sizeBytes: 18,
      },
      new: {
        kind: "text",
        revision: revisions.new,
        contents: "prefix\nnew\nsuffix\n",
        sizeBytes: 18,
      },
    });
  }
  it("loads on demand, preserves drafts and refuses revealed-line comments", async () => {
    const slot = renderTab({ getChanges: () => value, getTextContext: ready });
    const button = await slot.findByRole("button", { name: "Load context" });
    expect(callsTo(slot, "getTextContext")).toEqual([]);
    fireEvent.click(slot.getByRole("button", { name: "+ additions 2" }));
    fireEvent.change(slot.getByRole("textbox", { name: "Comment" }), {
      target: { value: "Keep this draft" },
    });
    fireEvent.click(button);
    await waitFor(() =>
      expect(slot.getByLabelText("After contents").textContent).toBe("prefix\nnew\nsuffix\n"),
    );
    expect(slot.getByTestId("file-diff").getAttribute("data-partial")).toBe("false");
    expect((slot.getByRole("textbox", { name: "Comment" }) as HTMLTextAreaElement).value).toBe(
      "Keep this draft",
    );
    fireEvent.click(slot.getByRole("button", { name: "+ additions 1" }));
    expect(slot.getByRole("status").textContent).toBe(
      "Revealed context is read-only. Comment on a line in the original diff.",
    );
    expect((slot.getByRole("textbox", { name: "Comment" }) as HTMLTextAreaElement).value).toBe(
      "Keep this draft",
    );
    fireEvent.click(slot.getByRole("button", { name: "Add to review" }));
    expect(slot.getByText("Keep this draft").textContent).toBe("Keep this draft");
    expect(slot.getByRole("button", { name: "Send feedback (1)" }).textContent).toBe(
      "Send feedback (1)",
    );
    fireEvent.click(slot.getByRole("button", { name: "+ deletions 2" }));
    expect(slot.getByRole("textbox", { name: "Comment" }).getAttribute("placeholder")).toBe(
      "Leave a comment",
    );
  });
  it("keeps the partial diff after failure, then retries", async () => {
    let attempts = 0;
    const slot = renderTab({
      getChanges: () => value,
      getTextContext: (input) =>
        ++attempts === 1
          ? { kind: "error", code: "read", message: "Could not load context. Retry." }
          : ready(input),
    });
    fireEvent.click(await slot.findByRole("button", { name: "Load context" }));
    await slot.findByRole("button", { name: "Retry context" });
    expect(slot.getByLabelText("After contents").textContent).toBe("new\n");
    expect(slot.getByRole("status").textContent).toBe("Could not load context. Retry.");
    fireEvent.click(slot.getByRole("button", { name: "Retry context" }));
    await waitFor(() =>
      expect(slot.getByLabelText("After contents").textContent).toBe("prefix\nnew\nsuffix\n"),
    );
  });
  it("invalidates at refresh start and blocks retained previous-generation patches", async () => {
    let loads = 0;
    let patchLoads = 0;
    let finishChanges!: (result: ChangesResult) => void;
    let finishPatch!: (result: PatchesResult) => void;
    let finishContext!: (result: TextContextResult) => void;
    let captured!: Omit<Snapshot, "generation">;
    const slot = renderTab({
      getChanges: () =>
        ++loads === 1
          ? changes([file("src/a.ts")], { imageBasis })
          : new Promise((resolve) => {
              finishChanges = resolve;
            }),
      getPatches: () =>
        ++patchLoads === 1
          ? { kind: "ok", patches: { "src/a.ts": patch } }
          : new Promise((resolve) => {
              finishPatch = resolve;
            }),
      getTextContext: (input) => {
        captured = input;
        return new Promise((resolve) => {
          finishContext = resolve;
        });
      },
    });
    fireEvent.click(await slot.findByRole("button", { name: "Load context" }));
    fireEvent.click(slot.getByRole("button", { name: "Refresh" }));
    expect(slot.queryByRole("button", { name: "Loading context…" })).toBeNull();
    await act(async () => finishContext(ready(captured)));
    expect(slot.getByLabelText("After contents").textContent).toBe("new\n");
    await act(async () => finishChanges(changes([file("src/a.ts")], { imageBasis })));
    expect(slot.queryByRole("button", { name: "Load context" })).toBeNull();
    expect(slot.getByLabelText("After contents").textContent).toBe("new\n");
    await act(async () => finishPatch({ kind: "ok", patches: { "src/a.ts": patch } }));
    expect((await slot.findByRole("button", { name: "Load context" })).textContent).toBe(
      "Load context",
    );
    expect(slot.getByLabelText("After contents").textContent).toBe("new\n");
  });
});
