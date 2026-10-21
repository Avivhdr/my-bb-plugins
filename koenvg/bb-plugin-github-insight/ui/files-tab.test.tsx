// @vitest-environment jsdom
import type { ImageWireResult } from "../core/image-content";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { ReactNode } from "react";
import type { DiffLineAnnotation, FileDiffMetadata, SelectedLineRange } from "@pierre/diffs";
import type {
  ActionResult,
  CreateCommentDraftResult,
  DraftsResult,
  ReplyResult,
  ReviewResult,
  rpcContract,
  SendToAgentResult,
  SubmitReviewResult,
} from "../contract";
import { parsePrFiles, type ReviewFile } from "../core/pr-files";
import type { ListedCommentDraft } from "../core/review-drafts";
import { parseReviewThreads, type ReviewThread } from "../core/review-threads";
import { placeThreads, type ThreadPlacement } from "../core/thread-placement";
import { fileIdentity } from "../core/viewed-marks";
import { postIntent } from "./command-intents";
import { FilesTab } from "./files-tab";
import prFiles from "../test/fixtures/pr-1-files.json";
import threadedPrFiles from "../test/fixtures/pr-25259-files.json";
import reviewThreads from "../test/fixtures/pr-25259-review-threads.json";

const DiffsContainer = "diffs-container" as unknown as "div";

vi.mock("@pierre/diffs/react", () => ({
  FileDiff: ({
    fileDiff,
    options,
    lineAnnotations = [],
    renderAnnotation,
    renderHeaderPrefix,
    renderHeaderMetadata,
  }: {
    fileDiff: FileDiffMetadata;
    options?: {
      collapsed?: boolean;
      onPostRender?: (node: HTMLElement) => void;
      diffStyle?: string;
      enableGutterUtility?: boolean;
      onGutterUtilityClick?: (range: SelectedLineRange) => void;
    };
    lineAnnotations?: DiffLineAnnotation<unknown>[];
    renderAnnotation?: (annotation: DiffLineAnnotation<unknown>) => ReactNode;
    renderHeaderPrefix?: () => ReactNode;
    renderHeaderMetadata?: () => ReactNode;
  }) => (
    <DiffsContainer
      ref={(element: HTMLElement | null) => {
        if (element === null) return;
        const root = element.shadowRoot ?? element.attachShadow({ mode: "open" });
        if (!root.querySelector("[data-diffs-header]")) {
          root.innerHTML = "<div data-diffs-header data-sticky><div data-title></div></div>";
          root.querySelector("[data-title]")!.textContent = fileDiff.name;
        }
        options?.onPostRender?.(element);
      }}
      data-testid="file-diff"
      data-path={fileDiff.name}
      data-additions={fileDiff.additionLines.join("")}
      data-type={fileDiff.type}
      data-diff-style={options?.diffStyle}
      data-gutter-utility={String(options?.enableGutterUtility ?? false)}
      data-collapsed={String(options?.collapsed ?? false)}
    >
      <div data-testid="file-diff-prefix">{renderHeaderPrefix?.()}</div>
      <div data-testid="file-diff-header">{renderHeaderMetadata?.()}</div>
      {options?.onGutterUtilityClick &&
        (["additions", "deletions"] as const).map((side) => (
          <button
            key={side}
            type="button"
            onClick={() => options.onGutterUtilityClick?.({ start: 4, end: 4, side })}
          >
            + {side} 4
          </button>
        ))}
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
    </DiffsContainer>
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

const resizeCallbacks = new Set<ResizeObserverCallback>();

class RecordedResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe() {
    resizeCallbacks.add(this.callback);
  }
  disconnect() {
    resizeCallbacks.delete(this.callback);
  }
}

beforeAll(() => {
  vi.stubGlobal("IntersectionObserver", VisibleAtOnce);
  vi.stubGlobal("ResizeObserver", RecordedResizeObserver);
});

const filesTab = { component: FilesTab };

afterEach(cleanup);

const noThreads: ThreadPlacement = { placed: [], outdated: [] };
const noReviewDrafts = {
  head: {
    prNodeId: "PR_1",
    oid: "def456",
    state: "OPEN",
    viewerIsAuthor: false,
    viewerReview: null,
  },
  commentDrafts: [],
  summaryDraft: null,
  viewedMarks: {},
  newCommentIds: [],
} satisfies Partial<ReviewResult>;
const recorded = {
  kind: "ok",
  files: parsePrFiles(prFiles),
  threads: noThreads,
  drafts: {},
  ...noReviewDrafts,
} satisfies ReviewResult;

const threadedFiles = parsePrFiles(threadedPrFiles);
const threaded = {
  kind: "ok",
  files: threadedFiles,
  threads: placeThreads(threadedFiles, parseReviewThreads([reviewThreads])),
  drafts: {},
  ...noReviewDrafts,
} satisfies ReviewResult;

interface RpcHandlers {
  getReview?: () => ReviewResult | Promise<ReviewResult>;
  getPrVideo?: () =>
    | import("../core/video-content").VideoWireResult
    | Promise<import("../core/video-content").VideoWireResult>;
  getPrImage?: () => ImageWireResult | Promise<ImageWireResult>;
  getDrafts?: () => DraftsResult | Promise<DraftsResult>;
  sendToAgent?: () => SendToAgentResult | Promise<SendToAgentResult>;
  reply?: () => ReplyResult | Promise<ReplyResult>;
  setResolved?: () => ActionResult | Promise<ActionResult>;
  saveDraft?: () => ActionResult | Promise<ActionResult>;
  discardDraft?: () => ActionResult | Promise<ActionResult>;
  createCommentDraft?: () => CreateCommentDraftResult | Promise<CreateCommentDraftResult>;
  saveCommentDraft?: () => ActionResult | Promise<ActionResult>;
  deleteCommentDraft?: () => ActionResult | Promise<ActionResult>;
  saveSummaryDraft?: () => ActionResult | Promise<ActionResult>;
  updateViewed?: () => ActionResult | Promise<ActionResult>;
  markCommentsSeen?: (input: {
    threadId: string;
    commentIds: string[];
  }) => ActionResult | Promise<ActionResult>;
  submitReview?: () => SubmitReviewResult | Promise<SubmitReviewResult>;
}

let summaryListener: BroadcastChannel | undefined;

function listenForSummaries(): unknown[] {
  const signals: unknown[] = [];
  summaryListener = new BroadcastChannel("github-insight.summary-written");
  summaryListener.onmessage = (event) => signals.push(event.data);
  return signals;
}

function stopListening() {
  summaryListener?.close();
  summaryListener = undefined;
}

const quietly = () => new Promise((resolve) => setTimeout(resolve, 20));

function renderTab(...results: ReviewResult[]) {
  return renderTabWith({}, ...results);
}

function renderTabSending(
  sendToAgent: () => SendToAgentResult | Promise<SendToAgentResult>,
  ...results: ReviewResult[]
) {
  return renderTabWith({ sendToAgent }, ...results);
}

function renderTabWith(handlers: RpcHandlers, ...results: ReviewResult[]) {
  return renderTabFor("thr_1", handlers, ...results);
}

function renderTabFor(threadId: string, handlers: RpcHandlers, ...results: ReviewResult[]) {
  let call = 0;
  const getReview = () => results[Math.min(call++, results.length - 1)]!;
  const getDrafts = (): DraftsResult => {
    const latest = results[Math.min(call, results.length - 1)]!;
    if (latest.kind !== "ok") return latest;
    const { drafts, commentDrafts, summaryDraft } = latest;
    return { kind: "ok", drafts, commentDrafts, summaryDraft };
  };
  return renderSlot<{ threadId: string; jump: null }, typeof rpcContract>(
    filesTab,
    { threadId, jump: null },
    {
      rpc: {
        getReview: handlers.getReview ?? getReview,
        getDrafts: handlers.getDrafts ?? getDrafts,
        getTimeline: () => ({ kind: "no_pr" }),
        addPrComment: () => ({ kind: "error", message: "unused" }),
        sendToAgent:
          handlers.sendToAgent ?? (() => ({ kind: "sent", delivery: "sent", threadCount: 1 })),
        getPrVideo:
          handlers.getPrVideo ?? (() => ({ kind: "error", code: "read", message: "unavailable" })),
        getPrImage:
          handlers.getPrImage ?? (() => ({ kind: "error", code: "read", message: "unavailable" })),
        getInsight: () => ({ kind: "no_pr" }),
        refresh: () => ({ kind: "no_pr" }),
        reply:
          handlers.reply ??
          (() => ({ kind: "posted", pendingReviewUrl: null, resolveError: null })),
        setResolved: handlers.setResolved ?? (() => ({ kind: "ok" })),
        saveDraft: handlers.saveDraft ?? (() => ({ kind: "ok" })),
        discardDraft: handlers.discardDraft ?? (() => ({ kind: "ok" })),
        createCommentDraft:
          handlers.createCommentDraft ?? (() => ({ kind: "created", draftId: "new1" })),
        saveCommentDraft: handlers.saveCommentDraft ?? (() => ({ kind: "ok" })),
        deleteCommentDraft: handlers.deleteCommentDraft ?? (() => ({ kind: "ok" })),
        saveSummaryDraft: handlers.saveSummaryDraft ?? (() => ({ kind: "ok" })),
        updateViewed: handlers.updateViewed ?? (() => ({ kind: "ok" })),
        markCommentsSeen: handlers.markCommentsSeen ?? (() => ({ kind: "ok" })),
        submitReview: handlers.submitReview ?? (() => ({ kind: "submitted" })),
        getReviewQueue: () => ({ kind: "error", message: "unused", lastGood: null }),
        refreshReviewQueue: () => ({ kind: "error", message: "unused", lastGood: null }),
        startReview: () => ({ threadId: "unused" }),
        getPrimaryHost: () => ({ hostId: null }),
        archiveReview: () => ({ kind: "error", message: "unused" }),
        markReviewed: () => ({ kind: "error", message: "unused" }),
        markNeedsReview: () => ({ kind: "error", message: "unused" }),
        markQueueSeen: () => ({ kind: "error", message: "unused" }),
        markThreadOpened: () => ({ kind: "error", message: "unused" }),
        runPrAction: () => ({ kind: "error", message: "unused" }),
        localCommitsAhead: () => ({ kind: "unknown" }),
        getPrInsight: () => ({ kind: "no_pr" }),
        refreshPrInsight: () => ({ kind: "no_pr" }),
      },
    },
  );
}
describe("PR raster review", () => {
  const imageBasis = {
    baseRepo: { owner: "base", repo: "private" },
    headRepo: { owner: "fork", repo: "private" },
    baseSha: "1111111111111111111111111111111111111111",
    headSha: "2222222222222222222222222222222222222222",
    mergeBaseSha: "3333333333333333333333333333333333333333",
    hostId: "host-1",
  };
  it.each(["mp4", "webm"])(
    "keeps an LFS %s pointer patch, inline draft and Viewed in PR Files",
    async (extension) => {
      const path = `clip.${extension}`;
      const patch = `@@ -1,3 +1,3 @@\n version https://git-lfs.github.com/spec/v1\n-oid sha256:${"1".repeat(64)}\n+oid sha256:${"2".repeat(64)}\n-size 10000000\n+size 10000001`;
      const slot = renderTabWith(
        {},
        {
          ...recorded,
          imageBasis,
          files: [{ path, previousPath: null, status: "modified", patch }],
          commentDrafts: [
            commentDraft(`lfs-${extension}`, {
              path,
              line: 2,
              body: "Keep the LFS object tracked",
            }),
          ],
        },
      );
      const diff = await slot.findByTestId("file-diff");
      expect(diff.getAttribute("data-additions")).toContain(
        "version https://git-lfs.github.com/spec/v1",
      );
      expect(diff.getAttribute("data-additions")).toContain("size 10000001");
      const draft = slot.getByRole("region", { name: "Pending comment" });
      expect(
        (within(draft).getByRole("textbox", { name: "Comment" }) as HTMLTextAreaElement).value,
      ).toBe("Keep the LFS object tracked");
      expect(draft.closest("[data-testid=line-annotation]")?.getAttribute("data-line")).toBe("2");
      expect(slot.queryByRole("button", { name: /Load (before|after) video/ })).toBeNull();
      expect(callsTo(slot, "getPrVideo")).toEqual([]);
      const viewed = slot.getByRole("checkbox", { name: `Viewed ${path}` }) as HTMLInputElement;
      fireEvent.click(viewed);
      await waitFor(() => expect(viewed.checked).toBe(true));
    },
  );
  it("loads video in production PR Files only on request and preserves it across draft refresh", async () => {
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:pr-video");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const play = vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue("probably");
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const slot = renderTabWith(
      {
        getPrVideo: () => ({
          kind: "ready",
          content: "AAAAAGZ0eXBpc29t",
          mime: "video/mp4",
          sizeBytes: 12,
        }),
      },
      {
        ...recorded,
        imageBasis,
        files: [{ path: "clip.mp4", previousPath: "old.mp4", status: "renamed", patch: null }],
      },
    );
    await slot.findByRole("button", { name: "Load before video" });
    expect(callsTo(slot, "getPrVideo")).toEqual([]);
    expect(callsTo(slot, "getPrImage")).toEqual([]);
    fireEvent.click(slot.getByRole("button", { name: "Load before video" }));
    const video = (await slot.findByLabelText(
      "Before: old.mp4 (3333333333333333333333333333333333333333)",
    )) as HTMLVideoElement;
    expect(video.controls).toBe(true);
    expect(video.autoplay).toBe(false);
    expect(callsTo(slot, "getPrVideo")).toMatchObject([{ side: "before", path: "clip.mp4" }]);
    await act(async () => {
      await slot.behavior.emitRealtime("review.drafts-updated", { threadId: "thr_1" });
    });
    expect(callsTo(slot, "getPrVideo")).toHaveLength(1);
    fireEvent.click(slot.getByRole("button", { name: "Collapse clip.mp4" }));
    expect(revoke).toHaveBeenCalledWith("blob:pr-video");
    expect(pause).toHaveBeenCalled();
    create.mockRestore();
    revoke.mockRestore();
    play.mockRestore();
    pause.mockRestore();
  });
  it("loads images without viewed controls and keeps draft-only refresh from reloading bytes", async () => {
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:pr");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const value: ReviewResult = {
      ...recorded,
      imageBasis,
      files: [{ path: "logo.png", previousPath: null, status: "added", patch: null }],
    };
    const slot = renderTabWith(
      {
        getPrImage: () => ({
          kind: "ready",
          content: "iVBORw0KGgoAAAAA",
          mime: "image/png",
          sizeBytes: 12,
        }),
      },
      value,
    );
    await slot.findByRole("img", {
      name: "After: logo.png (2222222222222222222222222222222222222222)",
    });
    expect(slot.getByText("Not present")).toBeTruthy();
    expect(callsTo(slot, "getPrImage")).toHaveLength(1);
    expect(slot.queryByRole("checkbox", { name: "Viewed logo.png" })).toBeNull();
    await act(async () => {
      await slot.behavior.emitRealtime("review.drafts-updated", { threadId: "thr_1" });
    });
    expect(callsTo(slot, "getPrImage")).toHaveLength(1);
    fireEvent.click(slot.getByRole("button", { name: "Collapse logo.png" }));
    expect(slot.queryByRole("img", { name: /^After:/ })).toBeNull();
    expect(revoke).toHaveBeenCalledWith("blob:pr");
    create.mockRestore();
    revoke.mockRestore();
  });
  it("releases images at reload start and ignores a delayed old completion", async () => {
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:late");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    let finishImage: ((value: ImageWireResult) => void) | undefined;
    let finishReview: ((value: ReviewResult) => void) | undefined;
    let count = 0;
    const value: ReviewResult = {
      ...recorded,
      imageBasis,
      files: [{ path: "logo.png", previousPath: null, status: "added", patch: null }],
    };
    const slot = renderTabWith(
      {
        getReview: () =>
          ++count === 1
            ? value
            : new Promise((resolve) => {
                finishReview = resolve;
              }),
        getPrImage: () =>
          new Promise((resolve) => {
            finishImage = resolve;
          }),
      },
      value,
    );
    await waitFor(() => expect(callsTo(slot, "getPrImage")).toHaveLength(1));
    await act(async () => {
      await slot.behavior.emitRealtime("review.updated", { threadId: "thr_1" });
    });
    await act(async () =>
      finishImage?.({
        kind: "ready",
        content: "iVBORw0KGgoAAAAA",
        mime: "image/png",
        sizeBytes: 12,
      }),
    );
    expect(create).not.toHaveBeenCalled();
    expect(slot.queryByRole("img", { name: /^After:/ })).toBeNull();
    await act(async () => finishReview?.(value));
    await waitFor(() => expect(callsTo(slot, "getPrImage")).toHaveLength(2));
    create.mockRestore();
    revoke.mockRestore();
  });
  it("keeps SVG patches reviewable as text", async () => {
    const source = recorded.files.find((file) => file.patch !== null)!;
    const slot = renderTab({ ...recorded, imageBasis, files: [{ ...source, path: "icon.svg" }] });
    await slot.findByTestId("file-diff");
    expect(callsTo(slot, "getPrImage")).toEqual([]);
    expect(slot.getByRole("checkbox", { name: "Viewed icon.svg" })).toBeTruthy();
  });
});

function methods(slot: ReturnType<typeof renderTab>) {
  return slot.inspection.rpcCalls.map((call) => call.method);
}

function callsTo(slot: ReturnType<typeof renderTab>, method: string) {
  return slot.inspection.rpcCalls
    .filter((call) => call.method === method)
    .map((call) => call.input);
}

describe("Files tab", () => {
  it("asks for the review of its own thread", async () => {
    const slot = renderTab({ kind: "no_pr" });

    await slot.findByText("No pull request for this thread");
    expect(slot.inspection.rpcCalls).toEqual([
      expect.objectContaining({ method: "getReview", input: { threadId: "thr_1" } }),
    ]);
  });

  it("shows a diff for each file with a patch, in GitHub's order", async () => {
    const slot = renderTab(recorded);

    await slot.findAllByTestId("file-diff");
    expect(slot.getAllByTestId("file-diff").map((diff) => diff.getAttribute("data-path"))).toEqual([
      "plugins/github-insight/app.tsx",
      "plugins/github-insight/core/pr-ref.ts",
    ]);
    expect(slot.getAllByTestId("file-diff")[0]!.getAttribute("data-type")).toBe("new");
  });

  it("shows the path and 'Diff not available' for a file without a patch", async () => {
    const slot = renderTab(recorded);

    const row = (await slot.findByText("plugins/github-insight/package-lock.json")).closest(
      "section",
    )!;
    expect(within(row).getByText("Diff not available")).toBeTruthy();
  });

  it("says how many files changed", async () => {
    const slot = renderTab(recorded);

    expect(await slot.findByText("3 files changed")).toBeTruthy();
  });

  it("shows the gh error with a retry that loads again", async () => {
    const slot = renderTab({ kind: "error", message: "gh not logged in" }, recorded);

    const alert = await slot.findByRole("alert");
    expect(within(alert).getByText("gh not logged in")).toBeTruthy();
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));

    await slot.findByText("3 files changed");
    expect(slot.inspection.rpcCalls.map((call) => call.method)).toEqual(["getReview", "getReview"]);
  });

  it("loads again on refresh and shows the new files", async () => {
    const slot = renderTab(recorded, { ...recorded, files: recorded.files.slice(0, 1) });

    await slot.findByText("3 files changed");
    fireEvent.click(slot.getByRole("button", { name: "Refresh" }));

    expect(await slot.findByText("1 file changed")).toBeTruthy();
  });

  it("shows the diff of a file that gets its patch on refresh", async () => {
    const withoutPatch = recorded.files.map((file) => ({ ...file, patch: null }));
    const slot = renderTab({ ...recorded, files: withoutPatch }, recorded);

    await slot.findAllByText("Diff not available");
    fireEvent.click(slot.getByRole("button", { name: "Refresh" }));

    expect(await slot.findAllByTestId("file-diff")).toHaveLength(2);
  });
});

describe("Files tab viewed files", () => {
  const APP = "plugins/github-insight/app.tsx";
  const PR_REF = "plugins/github-insight/core/pr-ref.ts";
  const LOCK = "plugins/github-insight/package-lock.json";
  let threadCount = 0;

  function fileAt(files: readonly ReviewFile[], path: string): ReviewFile {
    return files.find((file) => file.path === path)!;
  }

  function markedIn(files: readonly ReviewFile[], ...paths: string[]) {
    return Object.fromEntries(paths.map((path) => [path, fileIdentity(fileAt(files, path))!]));
  }

  function withFiles(files: ReviewFile[], viewedMarks: Record<string, string> = {}): ReviewResult {
    return { ...recorded, files, viewedMarks };
  }

  function editPatch(files: readonly ReviewFile[], path: string): ReviewFile[] {
    return files.map((file) =>
      file.path === path ? { ...file, patch: file.patch!.replace("\n+", "\n+edited ") } : file,
    );
  }

  function renderViewed(handlers: RpcHandlers, ...results: ReviewResult[]) {
    const threadId = `thr_viewed_${++threadCount}`;
    return Object.assign(renderTabFor(threadId, handlers, ...results), { threadId });
  }

  function diffOf(slot: ReturnType<typeof renderTab>, path: string) {
    return slot
      .getAllByTestId("file-diff")
      .find((diff) => diff.getAttribute("data-path") === path)!;
  }

  function checkbox(slot: ReturnType<typeof renderTab>, path: string) {
    return slot.getByRole("checkbox", { name: `Viewed ${path}` }) as HTMLInputElement;
  }

  it("marks a file as viewed, saves the mark, and collapses the file", async () => {
    const slot = renderViewed({}, withFiles(recorded.files));

    fireEvent.click(await slot.findByRole("checkbox", { name: `Viewed ${APP}` }));

    expect(checkbox(slot, APP).checked).toBe(true);
    expect(diffOf(slot, APP).dataset.collapsed).toBe("true");
    expect(diffOf(slot, PR_REF).dataset.collapsed).toBe("false");
    await waitFor(() =>
      expect(callsTo(slot, "updateViewed")).toEqual([
        { threadId: slot.threadId, set: markedIn(recorded.files, APP), remove: [] },
      ]),
    );
  });

  it("unmarks a viewed file that the user expanded and shows its diff", async () => {
    const slot = renderViewed({}, withFiles(recorded.files, markedIn(recorded.files, APP)));
    fireEvent.click(await slot.findByRole("button", { name: `Expand ${APP}` }));

    fireEvent.click(checkbox(slot, APP));

    expect(checkbox(slot, APP).checked).toBe(false);
    expect(diffOf(slot, APP).dataset.collapsed).toBe("false");
    await waitFor(() =>
      expect(callsTo(slot, "updateViewed")).toEqual([
        { threadId: slot.threadId, set: {}, remove: [APP] },
      ]),
    );
  });

  it("expands a viewed file without changing the mark or the counter", async () => {
    const slot = renderViewed({}, withFiles(recorded.files, markedIn(recorded.files, APP)));

    fireEvent.click(await slot.findByRole("button", { name: `Expand ${APP}` }));

    expect(diffOf(slot, APP).dataset.collapsed).toBe("false");
    expect(checkbox(slot, APP).checked).toBe(true);
    expect(slot.getByText("1/2 viewed")).toBeTruthy();
    expect(callsTo(slot, "updateViewed")).toEqual([]);
  });

  it("toggles only the clicked filename's accordion and keeps Viewed controls independent", async () => {
    const slot = renderViewed({}, withFiles(recorded.files, markedIn(recorded.files, APP)));
    await slot.findByRole("button", { name: `Expand ${APP}` });
    const filename = diffOf(slot, APP).shadowRoot!.querySelector("[data-title]")!;

    fireEvent.click(filename);
    expect(diffOf(slot, APP).dataset.collapsed).toBe("false");
    expect(diffOf(slot, PR_REF).dataset.collapsed).toBe("false");
    expect(checkbox(slot, APP).checked).toBe(true);
    expect(slot.getByText("1/2 viewed").textContent).toBe("1/2 viewed");
    expect(callsTo(slot, "updateViewed")).toEqual([]);

    fireEvent.click(filename);
    expect(diffOf(slot, APP).dataset.collapsed).toBe("true");
    fireEvent.click(checkbox(slot, APP));
    expect(diffOf(slot, APP).dataset.collapsed).toBe("false");
    expect(checkbox(slot, APP).checked).toBe(false);
    fireEvent.click(filename);
    expect(diffOf(slot, APP).dataset.collapsed).toBe("true");
    expect(checkbox(slot, APP).checked).toBe(false);
    expect(slot.getByText("0/2 viewed").textContent).toBe("0/2 viewed");
    fireEvent.click(slot.getByRole("button", { name: `Expand ${APP}` }));
    expect(diffOf(slot, APP).dataset.collapsed).toBe("false");
  });

  it("collapses a file that is not viewed and keeps it unmarked", async () => {
    const slot = renderViewed({}, withFiles(recorded.files));

    fireEvent.click(await slot.findByRole("button", { name: `Collapse ${PR_REF}` }));

    expect(diffOf(slot, PR_REF).dataset.collapsed).toBe("true");
    expect(checkbox(slot, PR_REF).checked).toBe(false);
  });

  it("keeps the thread count in the header of a viewed file", async () => {
    const files = threaded.files;
    const path = files[0]!.path;
    const slot = renderViewed({}, { ...threaded, viewedMarks: markedIn(files, path) });

    await slot.findAllByTestId("file-diff");

    expect(diffOf(slot, path).dataset.collapsed).toBe("true");
    expect(within(diffOf(slot, path)).getByTestId("file-diff-header").textContent).toBe("1Viewed");
  });

  it("shows no viewed checkbox for a file without a patch", async () => {
    const slot = renderViewed({}, withFiles(recorded.files));

    await slot.findAllByTestId("file-diff");

    expect(slot.queryByRole("checkbox", { name: `Viewed ${LOCK}` })).toBeNull();
    expect(slot.queryByRole("button", { name: `Collapse ${LOCK}` })).toBeNull();
  });

  it("counts the viewed files among the files that can be marked", async () => {
    const slot = renderViewed({}, withFiles(recorded.files, markedIn(recorded.files, APP)));

    expect(await slot.findByText("1/2 viewed")).toBeTruthy();
    fireEvent.click(await slot.findByRole("checkbox", { name: `Viewed ${PR_REF}` }));
    expect(slot.getByText("2/2 viewed")).toBeTruthy();
  });

  it("hides the counter when no file can be marked", async () => {
    const slot = renderViewed({}, withFiles([fileAt(recorded.files, LOCK)]));

    await slot.findByText("1 file changed");

    expect(slot.queryByText(/viewed$/)).toBeNull();
  });

  it("drops the mark and expands the file when a push changes it", async () => {
    const marks = markedIn(recorded.files, APP);
    const slot = renderViewed(
      {},
      withFiles(recorded.files, marks),
      withFiles(editPatch(recorded.files, APP), marks),
    );
    await slot.findByText("1/2 viewed");

    fireEvent.click(slot.getByRole("button", { name: "Refresh" }));

    expect(await slot.findByText("0/2 viewed")).toBeTruthy();
    expect(checkbox(slot, APP).checked).toBe(false);
    expect(diffOf(slot, APP).dataset.collapsed).toBe("false");
    await waitFor(() =>
      expect(callsTo(slot, "updateViewed")).toEqual([
        { threadId: slot.threadId, set: {}, remove: [APP] },
      ]),
    );
  });

  it("keeps the mark when a push changes only another file", async () => {
    const marks = markedIn(recorded.files, APP);
    const slot = renderViewed(
      {},
      withFiles(recorded.files, marks),
      withFiles(editPatch(recorded.files, PR_REF), marks),
    );
    await slot.findByText("1/2 viewed");

    fireEvent.click(slot.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(callsTo(slot, "getReview")).toHaveLength(2));

    expect(slot.getByText("1/2 viewed")).toBeTruthy();
    expect(diffOf(slot, APP).dataset.collapsed).toBe("true");
    expect(callsTo(slot, "updateViewed")).toEqual([]);
  });

  it("reverts the mark and shows the error when the save fails", async () => {
    const slot = renderViewed(
      { updateViewed: () => ({ kind: "error", message: "disk full" }) },
      withFiles(recorded.files),
    );

    fireEvent.click(await slot.findByRole("checkbox", { name: `Viewed ${APP}` }));

    expect((await slot.findByRole("alert")).textContent).toBe(
      "Could not save viewed state: disk full",
    );
    expect(checkbox(slot, APP).checked).toBe(false);
    expect(diffOf(slot, APP).dataset.collapsed).toBe("false");
  });
});

describe("Files tab threads", () => {
  const OPEN_THREAD = "There's no wait for the new row to mount";
  const REPLY = "Agreed, removed.";
  const RESOLVED_REPLY = "False positive.";

  function annotationWith(slot: ReturnType<typeof renderTab>, text: string) {
    return slot
      .getAllByTestId("line-annotation")
      .find((annotation) => annotation.textContent?.includes(text));
  }

  function withResolved(threadId: string): ReviewResult {
    const resolve = <T extends { id: string; resolved: boolean }>(thread: T) =>
      thread.id === threadId ? { ...thread, resolved: true } : thread;
    return {
      ...threaded,
      threads: {
        placed: threaded.threads.placed.map((placed) => ({
          ...placed,
          thread: resolve(placed.thread),
        })),
        outdated: threaded.threads.outdated.map(resolve),
      },
    };
  }

  it("shows each file diff split, with the add-comment gutter", async () => {
    const slot = renderTab(threaded);

    const diffs = await slot.findAllByTestId("file-diff");
    for (const diff of diffs) {
      expect(diff.dataset).toMatchObject({ diffStyle: "split", gutterUtility: "true" });
    }
  });

  it("shows the thread count in the file header", async () => {
    const slot = renderTab(threaded);

    const diff = (await slot.findAllByTestId("file-diff")).find((candidate) =>
      within(candidate)
        .queryAllByTestId("line-annotation")
        .some((annotation) => annotation.textContent?.includes(OPEN_THREAD)),
    )!;
    const threadCount = within(diff).getAllByTestId("line-annotation").length;
    expect(within(diff).getByTestId("file-diff-header").textContent).toBe(`${threadCount}Viewed`);
  });

  it("shows a thread below its line on the new side of its file", async () => {
    const slot = renderTab(threaded);

    await slot.findAllByTestId("line-annotation");
    const annotation = annotationWith(slot, OPEN_THREAD)!;
    expect(annotation.dataset).toMatchObject({ side: "additions", line: "46" });
    expect(annotation.closest("[data-testid=file-diff]")!.getAttribute("data-path")).toBe(
      "apps/shell/e2e/catalog/integrations/components/asset/generic-configuration/createDatabricksOutboundSyncConfigurationComponent.ts",
    );
  });

  it("shows each comment with its author, time, and Markdown body, in order", async () => {
    const slot = renderTab(threaded);

    await slot.findAllByTestId("line-annotation");
    const thread = within(annotationWith(slot, OPEN_THREAD)!);
    const bodies = thread.getAllByTestId("bb-markdown").map((body) => body.textContent);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toMatch(/^There's no wait/);
    expect(thread.getByText("a-bandziuk")).toBeTruthy();
    expect(thread.getByText("RuslanPleskunCollibra")).toBeTruthy();
    expect(thread.getAllByRole("time").map((time) => time.getAttribute("datetime"))).toEqual([
      "2026-09-18T14:34:40.000Z",
      "2026-09-18T15:17:49.000Z",
    ]);
  });

  it("scrolls wide code blocks in a comment body inside the card", async () => {
    const slot = renderTab(threaded);

    await slot.findAllByTestId("line-annotation");
    const thread = within(annotationWith(slot, OPEN_THREAD)!);
    for (const body of thread.getAllByTestId("bb-markdown")) {
      expect(body.parentElement!.classList).toContain("[&_pre]:overflow-x-auto");
    }
  });

  it("shows an outdated thread at the top with its path, original line, and snippet", async () => {
    const slot = renderTab(threaded);

    const section = within(await slot.findByRole("region", { name: "Outdated" }));
    expect(
      section.getByText(
        "apps/shell/e2e/catalog/integrations/components/helpers/clickWithScrollHelper.ts",
      ),
    ).toBeTruthy();
    expect(section.getByText("Line 32")).toBeTruthy();
    const snippet = section.getByTestId("bb-diff");
    expect(snippet.textContent).toMatch(/^@@ -10,22 \+14,31 @@/);
    expect(snippet.getAttribute("data-path")).toBe(
      "apps/shell/e2e/catalog/integrations/components/helpers/clickWithScrollHelper.ts",
    );
    expect(section.getByText(REPLY, { exact: false })).toBeTruthy();
  });

  it("hides resolved threads", async () => {
    const slot = renderTab(withResolved("PRRT_kwDOHI7l-86jxula"));

    await slot.findAllByTestId("line-annotation");
    expect(annotationWith(slot, OPEN_THREAD)).toBeUndefined();
    expect(slot.queryByText(RESOLVED_REPLY, { exact: false })).toBeNull();
  });

  it("shows resolved threads collapsed when 'Show resolved' is on, and expands one", async () => {
    const slot = renderTab(withResolved("PRRT_kwDOHI7l-86jxula"));

    fireEvent.click(await slot.findByRole("checkbox", { name: "Show resolved" }));

    const collapsed = annotationWith(slot, "Resolved")!;
    expect(collapsed.dataset).toMatchObject({ side: "additions", line: "46" });
    expect(within(collapsed).queryByTestId("bb-markdown")).toBeNull();
    const toggle = within(collapsed).getByRole("button", { name: /a-bandziuk.*Resolved/ });
    fireEvent.click(toggle);
    expect(within(collapsed).getAllByTestId("bb-markdown")).toHaveLength(2);

    const outdated = within(slot.getByRole("region", { name: "Outdated" }));
    expect(outdated.getByRole("button", { name: /wiz-22f56a2082.*Resolved/ })).toBeTruthy();
  });

  it("counts open threads and outdated open threads", async () => {
    const slot = renderTab(threaded);

    expect(await slot.findByText("3 open")).toBeTruthy();
    expect(slot.getByText("1 outdated")).toBeTruthy();
  });

  it("leaves resolved threads out of the counts", async () => {
    const slot = renderTab(withResolved("PRRT_kwDOHI7l-86jx0SN"));

    expect(await slot.findByText("2 open")).toBeTruthy();
    expect(slot.getByText("0 outdated")).toBeTruthy();
  });

  it("links to GitHub when a thread has more comments than were loaded", async () => {
    const [first, ...rest] = threaded.threads.placed;
    const slot = renderTab({
      ...threaded,
      threads: {
        ...threaded.threads,
        placed: [{ ...first!, thread: { ...first!.thread, hasMoreComments: true } }, ...rest],
      },
    });

    const link = await slot.findByRole("link", { name: "More comments on GitHub" });
    expect(link.getAttribute("href")).toBe(first!.thread.comments.at(-1)!.url);
  });

  it("has no Outdated section when no outdated thread shows", async () => {
    const slot = renderTab(withResolved("PRRT_kwDOHI7l-86jx0SN"));

    await slot.findByText("2 open");
    expect(slot.queryByRole("region", { name: "Outdated" })).toBeNull();
  });
});

describe("Files tab drafts", () => {
  const PLACED = "PRRT_kwDOHI7l-86jxula";
  const OUTDATED = "PRRT_kwDOHI7l-86jx0SN";
  const draft = { body: "Renamed in abc123", updatedAt: 1, source: "agent" as const };

  function withDraft(reviewThreadId: string): ReviewResult {
    return { ...threaded, drafts: { [reviewThreadId]: draft } };
  }

  async function findDraft(slot: ReturnType<typeof renderTab>) {
    const section = await slot.findByRole("region", { name: "Draft from agent" });
    return {
      section,
      box: within(section).getByRole("textbox", { name: "Reply" }) as HTMLTextAreaElement,
    };
  }

  it("puts the draft in the reply box below the comments of its thread, as 'Draft from agent'", async () => {
    const slot = renderTab(withDraft(PLACED));

    const { section, box } = await findDraft(slot);
    expect(box.value).toBe("Renamed in abc123");
    const card = section.closest("article")!;
    expect(card.textContent).toContain("There's no wait for the new row to mount");
    const lastComment = within(card).getAllByTestId("bb-markdown").at(-1)!;
    expect(
      lastComment.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows the draft of an outdated thread", async () => {
    const slot = renderTab(withDraft(OUTDATED));

    const outdated = within(await slot.findByRole("region", { name: "Outdated" }));
    const section = outdated.getByRole("region", { name: "Draft from agent" });
    expect(
      (within(section).getByRole("textbox", { name: "Reply" }) as HTMLTextAreaElement).value,
    ).toBe("Renamed in abc123");
  });

  it("shows the draft text as written, not as Markdown", async () => {
    const slot = renderTab({
      ...threaded,
      drafts: { [PLACED]: { ...draft, body: "**bold**\nnext" } },
    });

    const { section, box } = await findDraft(slot);
    expect(within(section).queryByTestId("bb-markdown")).toBeNull();
    expect(box.value).toBe("**bold**\nnext");
  });

  it("shows a draft saved while the tab is open, loading only the drafts", async () => {
    const slot = renderTab(threaded, withDraft(PLACED));
    await slot.findByText("3 open");

    await slot.behavior.emitRealtime("review.drafts-updated", { threadId: "thr_1" });

    expect((await findDraft(slot)).box.value).toBe("Renamed in abc123");
    expect(methods(slot)).toEqual(["getReview", "getDrafts"]);
  });

  it.each(["review.updated", "review.drafts-updated"])(
    "ignores a %s event of another thread",
    async (channel) => {
      const slot = renderTab(threaded, withDraft(PLACED));
      await slot.findByText("3 open");

      await slot.behavior.emitRealtime(channel, { threadId: "thr_2" });

      expect(methods(slot)).toEqual(["getReview"]);
    },
  );

  it("loads the whole review when the drafts cannot be loaded", async () => {
    const slot = renderTabWith(
      { getDrafts: () => ({ kind: "error", message: "No pull request for this thread" }) },
      threaded,
      withDraft(PLACED),
    );
    await slot.findByText("3 open");

    await slot.behavior.emitRealtime("review.drafts-updated", { threadId: "thr_1" });

    expect((await findDraft(slot)).box.value).toBe("Renamed in abc123");
    expect(methods(slot)).toEqual(["getReview", "getDrafts", "getReview"]);
  });

  it("has 'Discard' only on a thread with a draft", async () => {
    const slot = renderTab(withDraft(PLACED));

    const card = within((await findDraft(slot)).section.closest("article")!);
    const discard = card.getByRole("button", { name: "Discard" });
    expect(slot.getAllByRole("button", { name: "Discard" })).toEqual([discard]);
  });

  it("posts the edited draft, saves the edit first, and drops the draft", async () => {
    const slot = renderTab(withDraft(PLACED), threaded);
    const { box } = await findDraft(slot);

    fireEvent.change(box, { target: { value: "Renamed in def456" } });
    fireEvent.click(within(box.closest("article")!).getByRole("button", { name: "Post" }));

    await waitFor(() =>
      expect(slot.queryByRole("region", { name: "Draft from agent" })).toBeNull(),
    );
    expect(methods(slot)).toEqual(["getReview", "saveDraft", "reply", "getReview"]);
    expect(callsTo(slot, "reply")).toEqual([
      { threadId: "thr_1", reviewThreadId: PLACED, body: "Renamed in def456", resolve: false },
    ]);
  });

  it("posts and resolves the draft on 'Post + resolve'", async () => {
    const slot = renderTab(withDraft(PLACED), threaded);
    const { box } = await findDraft(slot);

    fireEvent.click(
      within(box.closest("article")!).getByRole("button", { name: "Post + resolve" }),
    );

    await waitFor(() =>
      expect(slot.queryByRole("region", { name: "Draft from agent" })).toBeNull(),
    );
    expect(callsTo(slot, "reply")).toEqual([
      { threadId: "thr_1", reviewThreadId: PLACED, body: "Renamed in abc123", resolve: true },
    ]);
  });

  it("discards the draft without a GitHub write, and loads only the drafts again", async () => {
    const slot = renderTab(withDraft(PLACED), threaded);
    const { box } = await findDraft(slot);
    const card = within(box.closest("article")!);

    fireEvent.click(card.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(methods(slot)).toEqual(["getReview", "discardDraft"]));
    await slot.behavior.emitRealtime("review.drafts-updated", { threadId: "thr_1" });

    await waitFor(() =>
      expect(slot.queryByRole("region", { name: "Draft from agent" })).toBeNull(),
    );
    expect((card.getByRole("textbox", { name: "Reply" }) as HTMLTextAreaElement).value).toBe("");
    await waitFor(() => expect(methods(slot)).toEqual(["getReview", "discardDraft", "getDrafts"]));
    expect(callsTo(slot, "discardDraft")).toEqual([{ threadId: "thr_1", reviewThreadId: PLACED }]);
  });

  it("does not announce a new summary after a discard", async () => {
    const signals = listenForSummaries();
    const slot = renderTab(withDraft(PLACED), threaded);
    const { box } = await findDraft(slot);

    fireEvent.click(within(box.closest("article")!).getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(methods(slot)).toEqual(["getReview", "discardDraft"]));
    await slot.behavior.emitRealtime("review.drafts-updated", { threadId: "thr_1" });

    await waitFor(() => expect(methods(slot)).toEqual(["getReview", "discardDraft", "getDrafts"]));
    await quietly();
    stopListening();
    expect(signals).toEqual([]);
  });

  it("keeps the draft and shows the error when the discard fails", async () => {
    const slot = renderTabWith(
      { discardDraft: () => ({ kind: "error", message: "No pull request for this thread" }) },
      withDraft(PLACED),
    );
    const { box } = await findDraft(slot);

    fireEvent.click(within(box.closest("article")!).getByRole("button", { name: "Discard" }));

    expect((await slot.findByRole("alert")).textContent).toBe("No pull request for this thread");
    expect((await findDraft(slot)).box.value).toBe("Renamed in abc123");
  });

  it("keeps the edited draft and shows the error when the post fails", async () => {
    const slot = renderTabWith(
      { reply: () => ({ kind: "post_failed", message: "gh not logged in" }) },
      withDraft(PLACED),
    );
    const { box } = await findDraft(slot);

    fireEvent.change(box, { target: { value: "Renamed in def456" } });
    fireEvent.click(within(box.closest("article")!).getByRole("button", { name: "Post" }));

    expect((await slot.findByRole("alert")).textContent).toBe("gh not logged in");
    expect((await findDraft(slot)).box.value).toBe("Renamed in def456");
    expect(methods(slot)).toEqual(["getReview", "saveDraft", "reply"]);
  });

  it("saves the last edit of a draft once the typing stops", async () => {
    const slot = renderTab(withDraft(PLACED));
    const { box } = await findDraft(slot);

    fireEvent.change(box, { target: { value: "Renamed" } });
    fireEvent.change(box, { target: { value: "Renamed in def456" } });

    await waitFor(() => expect(callsTo(slot, "saveDraft")).toHaveLength(1));
    expect(callsTo(slot, "saveDraft")).toEqual([
      { threadId: "thr_1", reviewThreadId: PLACED, body: "Renamed in def456" },
    ]);
  });

  it("saves an unsaved edit when the tab closes", async () => {
    const slot = renderTab(withDraft(PLACED));
    const { box } = await findDraft(slot);

    fireEvent.change(box, { target: { value: "Renamed in def456" } });
    slot.unmount();

    await waitFor(() =>
      expect(callsTo(slot, "saveDraft")).toEqual([
        { threadId: "thr_1", reviewThreadId: PLACED, body: "Renamed in def456" },
      ]),
    );
  });

  it("shows the error when an edit cannot be saved", async () => {
    const slot = renderTabWith(
      { saveDraft: () => ({ kind: "error", message: "No pull request for this thread" }) },
      withDraft(PLACED),
    );
    const { box } = await findDraft(slot);

    fireEvent.change(box, { target: { value: "Renamed in def456" } });

    expect((await slot.findByRole("alert")).textContent).toBe("No pull request for this thread");
  });

  it("saves an unsaved edit before it resolves the thread", async () => {
    const slot = renderTab(withDraft(PLACED));
    const { box } = await findDraft(slot);

    fireEvent.change(box, { target: { value: "Renamed in def456" } });
    fireEvent.click(within(box.closest("article")!).getByRole("button", { name: "Resolve" }));

    await waitFor(() =>
      expect(methods(slot)).toEqual(["getReview", "saveDraft", "setResolved", "getReview"]),
    );
  });

  it("does not save a reply on a thread without a draft", async () => {
    const slot = renderTab(withDraft(OUTDATED));
    const annotation = (await slot.findAllByTestId("line-annotation")).find((candidate) =>
      candidate.textContent?.includes("There's no wait"),
    )!;

    fireEvent.change(within(annotation).getByRole("textbox", { name: "Reply" }), {
      target: { value: "Half written" },
    });
    slot.unmount();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(callsTo(slot, "saveDraft")).toEqual([]);
  });

  it("keeps the edited text when the tab loads the stored draft again", async () => {
    const slot = renderTab(withDraft(PLACED));
    const { box } = await findDraft(slot);

    fireEvent.change(box, { target: { value: "Renamed in def456" } });
    await slot.behavior.emitRealtime("review.drafts-updated", { threadId: "thr_1" });

    await waitFor(() => expect(methods(slot)).toContain("getDrafts"));
    expect((await findDraft(slot)).box.value).toBe("Renamed in def456");
  });
});

describe("Files tab send to agent", () => {
  const PLACED = "PRRT_kwDOHI7l-86jxula";
  const OUTDATED = "PRRT_kwDOHI7l-86jx0SN";
  const PLACED_TEXT = "There's no wait for the new row to mount";

  function checkboxOf(slot: ReturnType<typeof renderTab>, text: string) {
    const card = slot
      .getAllByRole("article")
      .find((article) => article.textContent?.includes(text))!;
    return within(card).getByRole("checkbox", { name: "Add to agent" }) as HTMLInputElement;
  }

  function outdatedCheckbox(slot: ReturnType<typeof renderTab>) {
    return within(slot.getByRole("region", { name: "Outdated" })).getByRole("checkbox", {
      name: "Add to agent",
    }) as HTMLInputElement;
  }

  async function selectTwo(slot: ReturnType<typeof renderTab>) {
    await slot.findAllByTestId("line-annotation");
    fireEvent.click(checkboxOf(slot, PLACED_TEXT));
    fireEvent.click(outdatedCheckbox(slot));
  }

  function sendCalls(slot: ReturnType<typeof renderTab>) {
    return slot.inspection.rpcCalls.filter((call) => call.method === "sendToAgent");
  }

  it("has a checkbox on each open thread and no send button before a selection", async () => {
    const slot = renderTab(threaded);

    await slot.findAllByTestId("line-annotation");
    expect(slot.getAllByRole("checkbox", { name: "Add to agent" })).toHaveLength(3);
    expect(slot.queryByRole("button", { name: /to agent/ })).toBeNull();
  });

  it("counts the selected threads", async () => {
    const slot = renderTab(threaded);

    await selectTwo(slot);
    expect(
      (slot.getByRole("button", { name: "Send 2 to agent" }) as HTMLButtonElement).disabled,
    ).toBe(false);

    fireEvent.click(outdatedCheckbox(slot));
    expect(slot.getByRole("button", { name: "Send 1 to agent" })).toBeTruthy();
  });

  it("has no checkbox on a resolved thread", async () => {
    const slot = renderTab(threaded);

    fireEvent.click(await slot.findByRole("checkbox", { name: "Show resolved" }));
    const resolved = within(slot.getByRole("region", { name: "Outdated" })).getByRole("button", {
      name: /wiz-22f56a2082.*Resolved/,
    });
    fireEvent.click(resolved);

    expect(within(resolved.closest("article")!).queryByRole("checkbox")).toBeNull();
    expect(slot.getAllByRole("checkbox", { name: "Add to agent" })).toHaveLength(3);
  });

  it("sends the selected threads of its own thread, then clears the selection", async () => {
    const slot = renderTabSending(
      () => ({ kind: "sent", delivery: "sent", threadCount: 2 }),
      threaded,
    );
    await selectTwo(slot);

    fireEvent.click(slot.getByRole("button", { name: "Send 2 to agent" }));

    await waitFor(() => expect(slot.queryByRole("button", { name: /to agent/ })).toBeNull());
    expect(sendCalls(slot)).toEqual([
      expect.objectContaining({
        input: { threadId: "thr_1", reviewThreadIds: [PLACED, OUTDATED] },
      }),
    ]);
    expect(checkboxOf(slot, PLACED_TEXT).checked).toBe(false);
    expect(slot.getByText("Sent to agent")).toBeTruthy();
  });

  it("says when the message waits for a busy agent", async () => {
    const slot = renderTabSending(
      () => ({ kind: "sent", delivery: "queued", threadCount: 2 }),
      threaded,
    );
    await selectTwo(slot);

    fireEvent.click(slot.getByRole("button", { name: "Send 2 to agent" }));

    expect(await slot.findByText("Queued until the agent is idle")).toBeTruthy();
  });

  it("says how many threads were sent when some got resolved in the meantime", async () => {
    const slot = renderTabSending(
      () => ({ kind: "sent", delivery: "sent", threadCount: 1 }),
      threaded,
    );
    await selectTwo(slot);

    fireEvent.click(slot.getByRole("button", { name: "Send 2 to agent" }));

    expect(await slot.findByText("Sent 1 of 2 to agent")).toBeTruthy();
  });

  it("keeps a thread selected during the send, which was not sent", async () => {
    let finish: (result: SendToAgentResult) => void = () => {};
    const slot = renderTabSending(() => new Promise((resolve) => (finish = resolve)), threaded);
    await slot.findAllByTestId("line-annotation");
    fireEvent.click(checkboxOf(slot, PLACED_TEXT));

    fireEvent.click(slot.getByRole("button", { name: "Send 1 to agent" }));
    fireEvent.click(outdatedCheckbox(slot));
    await act(async () => finish({ kind: "sent", delivery: "sent", threadCount: 1 }));

    expect(outdatedCheckbox(slot).checked).toBe(true);
    expect(checkboxOf(slot, PLACED_TEXT).checked).toBe(false);
  });

  it("shows the error and keeps the selection when the send fails", async () => {
    const slot = renderTabSending(() => ({ kind: "error", message: "gh not logged in" }), threaded);
    await selectTwo(slot);

    fireEvent.click(slot.getByRole("button", { name: "Send 2 to agent" }));

    const alert = await slot.findByRole("alert");
    expect(alert.textContent).toContain("gh not logged in");
    expect(slot.getByRole("button", { name: "Send 2 to agent" })).toBeTruthy();
    expect(checkboxOf(slot, PLACED_TEXT).checked).toBe(true);
  });

  it("shows the error and keeps the selection when the call throws", async () => {
    const slot = renderTabSending(() => {
      throw new Error("Thread is archived");
    }, threaded);
    await selectTwo(slot);

    fireEvent.click(slot.getByRole("button", { name: "Send 2 to agent" }));

    expect((await slot.findByRole("alert")).textContent).toContain("Thread is archived");
    expect(slot.getByRole("button", { name: "Send 2 to agent" })).toBeTruthy();
  });

  it("stops counting a selected thread that got resolved", async () => {
    const resolved = {
      ...threaded,
      threads: {
        ...threaded.threads,
        outdated: threaded.threads.outdated.map((thread) => ({ ...thread, resolved: true })),
      },
    };
    const slot = renderTab(threaded, resolved);
    await selectTwo(slot);

    await slot.behavior.emitRealtime("review.updated", { threadId: "thr_1" });

    expect(await slot.findByRole("button", { name: "Send 1 to agent" })).toBeTruthy();
  });
});

describe("Files tab thread actions", () => {
  const PLACED = "PRRT_kwDOHI7l-86jxula";
  const OPEN_THREAD = "There's no wait for the new row to mount";
  const REPLY = 'Fixed in "abc123"\nThanks';

  async function openCard(slot: ReturnType<typeof renderTab>) {
    await slot.findAllByTestId("line-annotation");
    const annotation = slot
      .getAllByTestId("line-annotation")
      .find((candidate) => candidate.textContent?.includes(OPEN_THREAD))!;
    return within(annotation.querySelector("article")!);
  }

  function typeReply(card: Awaited<ReturnType<typeof openCard>>, text = REPLY) {
    fireEvent.change(card.getByRole("textbox", { name: "Reply" }), { target: { value: text } });
  }

  function writeCalls(slot: ReturnType<typeof renderTab>) {
    return slot.inspection.rpcCalls.filter((call) => call.method !== "getReview");
  }

  function resolvedPlaced(): ReviewResult {
    return {
      ...threaded,
      threads: {
        ...threaded.threads,
        placed: threaded.threads.placed.map((placed) =>
          placed.thread.id === PLACED
            ? { ...placed, thread: { ...placed.thread, resolved: true } }
            : placed,
        ),
      },
    };
  }

  it("does not post an empty reply", async () => {
    const card = await openCard(renderTab(threaded));

    expect(card.getByRole("button", { name: "Post" }).hasAttribute("disabled")).toBe(true);
    typeReply(card, "   ");
    expect(card.getByRole("button", { name: "Post + resolve" }).hasAttribute("disabled")).toBe(
      true,
    );
  });

  it("posts the reply, clears the box, and loads the thread again", async () => {
    const slot = renderTab(threaded);
    const card = await openCard(slot);

    typeReply(card);
    fireEvent.click(card.getByRole("button", { name: "Post" }));

    await waitFor(() =>
      expect(slot.inspection.rpcCalls.map((call) => call.method)).toEqual([
        "getReview",
        "reply",
        "getReview",
      ]),
    );
    expect(writeCalls(slot)[0]!.input).toEqual({
      threadId: "thr_1",
      reviewThreadId: PLACED,
      body: REPLY,
      resolve: false,
    });
    expect((card.getByRole("textbox", { name: "Reply" }) as HTMLTextAreaElement).value).toBe("");
  });

  it("asks to post and resolve on 'Post + resolve'", async () => {
    const slot = renderTab(threaded);
    const card = await openCard(slot);

    typeReply(card);
    fireEvent.click(card.getByRole("button", { name: "Post + resolve" }));

    await waitFor(() => expect(writeCalls(slot)).toHaveLength(1));
    expect(writeCalls(slot)[0]!.input).toMatchObject({ reviewThreadId: PLACED, resolve: true });
  });

  it("shows the error and keeps the text when the post fails", async () => {
    const slot = renderTabWith(
      { reply: () => ({ kind: "post_failed", message: "gh not logged in" }) },
      threaded,
    );
    const card = await openCard(slot);

    typeReply(card);
    fireEvent.click(card.getByRole("button", { name: "Post" }));

    expect((await card.findByRole("alert")).textContent).toBe("gh not logged in");
    expect((card.getByRole("textbox", { name: "Reply" }) as HTMLTextAreaElement).value).toBe(REPLY);
    expect(slot.inspection.rpcCalls.map((call) => call.method)).toEqual(["getReview", "reply"]);
  });

  it("keeps the text when the reply call itself fails", async () => {
    const slot = renderTabWith(
      { reply: () => Promise.reject(new Error("host unreachable")) },
      threaded,
    );
    const card = await openCard(slot);

    typeReply(card);
    fireEvent.click(card.getByRole("button", { name: "Post" }));

    expect((await card.findByRole("alert")).textContent).toBe("host unreachable");
    expect((card.getByRole("textbox", { name: "Reply" }) as HTMLTextAreaElement).value).toBe(REPLY);
  });

  it("disables the box and the actions while a post runs", async () => {
    const slot = renderTabWith({ reply: () => new Promise<ReplyResult>(() => {}) }, threaded);
    const card = await openCard(slot);

    typeReply(card);
    fireEvent.click(card.getByRole("button", { name: "Post" }));

    await waitFor(() =>
      expect(card.getByRole("textbox", { name: "Reply" }).hasAttribute("disabled")).toBe(true),
    );
    for (const name of ["Post", "Post + resolve", "Resolve"]) {
      expect(card.getByRole("button", { name }).hasAttribute("disabled")).toBe(true);
    }
  });

  it("shows the resolve error after the reply was posted", async () => {
    const slot = renderTabWith(
      { reply: () => ({ kind: "posted", pendingReviewUrl: null, resolveError: "rate limited" }) },
      threaded,
    );
    const card = await openCard(slot);

    typeReply(card);
    fireEvent.click(card.getByRole("button", { name: "Post + resolve" }));

    expect((await card.findByRole("alert")).textContent).toBe("rate limited");
    expect((card.getByRole("textbox", { name: "Reply" }) as HTMLTextAreaElement).value).toBe("");
    await waitFor(() =>
      expect(slot.inspection.rpcCalls.map((call) => call.method)).toEqual([
        "getReview",
        "reply",
        "getReview",
      ]),
    );
  });

  it("says when the reply went into the user's pending review", async () => {
    const prUrl = "https://github.com/collibra/frontend/pull/25259";
    const slot = renderTabWith(
      { reply: () => ({ kind: "posted", pendingReviewUrl: prUrl, resolveError: null }) },
      threaded,
    );
    const card = await openCard(slot);

    typeReply(card);
    fireEvent.click(card.getByRole("button", { name: "Post" }));

    const notice = await card.findByText("Reply added to your pending review.", { exact: false });
    expect(within(notice).getByRole("link", { name: "Open the PR" }).getAttribute("href")).toBe(
      prUrl,
    );
  });

  it("resolves the thread and loads again", async () => {
    const slot = renderTab(threaded, resolvedPlaced());
    const card = await openCard(slot);

    fireEvent.click(card.getByRole("button", { name: "Resolve" }));

    await waitFor(() => expect(slot.queryByText(OPEN_THREAD, { exact: false })).toBeNull());
    expect(writeCalls(slot).map((call) => call.input)).toEqual([
      { threadId: "thr_1", reviewThreadId: PLACED, resolved: true },
    ]);
  });

  it("shows the error when the resolve fails", async () => {
    const slot = renderTabWith(
      { setResolved: () => ({ kind: "error", message: "rate limited" }) },
      threaded,
    );
    const card = await openCard(slot);

    fireEvent.click(card.getByRole("button", { name: "Resolve" }));

    expect((await card.findByRole("alert")).textContent).toBe("rate limited");
    expect(slot.inspection.rpcCalls.map((call) => call.method)).toEqual([
      "getReview",
      "setResolved",
    ]);
  });

  it("unresolves a resolved thread, which has no reply box", async () => {
    const slot = renderTab(resolvedPlaced());

    fireEvent.click(await slot.findByRole("checkbox", { name: "Show resolved" }));
    fireEvent.click(slot.getByRole("button", { name: /a-bandziuk.*Resolved/ }));
    const card = within(
      slot.getByRole("button", { name: /a-bandziuk.*Resolved/ }).closest("article")!,
    );
    expect(card.queryByRole("textbox", { name: "Reply" })).toBeNull();
    fireEvent.click(card.getByRole("button", { name: "Unresolve" }));

    await waitFor(() =>
      expect(writeCalls(slot).map((call) => call.input)).toEqual([
        { threadId: "thr_1", reviewThreadId: PLACED, resolved: false },
      ]),
    );
  });

  describe("summary signal", () => {
    let signals: unknown[];

    afterEach(stopListening);

    async function noSignalAfter(slot: ReturnType<typeof renderTab>, calls: number) {
      await waitFor(() => expect(slot.inspection.rpcCalls).toHaveLength(calls));
      await quietly();
      expect(signals).toEqual([]);
    }

    it("announces the new summary after a resolve", async () => {
      signals = listenForSummaries();
      const card = await openCard(renderTab(threaded, resolvedPlaced()));

      fireEvent.click(card.getByRole("button", { name: "Resolve" }));

      await waitFor(() => expect(signals).toEqual([{ threadId: "thr_1" }]));
    });

    it("announces the new summary after an unresolve", async () => {
      signals = listenForSummaries();
      const slot = renderTab(resolvedPlaced());
      fireEvent.click(await slot.findByRole("checkbox", { name: "Show resolved" }));
      fireEvent.click(slot.getByRole("button", { name: /a-bandziuk.*Resolved/ }));
      const card = within(
        slot.getByRole("button", { name: /a-bandziuk.*Resolved/ }).closest("article")!,
      );

      fireEvent.click(card.getByRole("button", { name: "Unresolve" }));

      await waitFor(() => expect(signals).toEqual([{ threadId: "thr_1" }]));
    });

    it("announces the new summary after a post and resolve", async () => {
      signals = listenForSummaries();
      const card = await openCard(renderTab(threaded));

      typeReply(card);
      fireEvent.click(card.getByRole("button", { name: "Post + resolve" }));

      await waitFor(() => expect(signals).toEqual([{ threadId: "thr_1" }]));
    });

    it("does not announce after a post without resolve", async () => {
      signals = listenForSummaries();
      const slot = renderTab(threaded);
      const card = await openCard(slot);

      typeReply(card);
      fireEvent.click(card.getByRole("button", { name: "Post" }));

      await noSignalAfter(slot, 3);
    });

    it("does not announce when the resolve fails", async () => {
      signals = listenForSummaries();
      const slot = renderTabWith(
        { setResolved: () => ({ kind: "error", message: "rate limited" }) },
        threaded,
      );
      const card = await openCard(slot);

      fireEvent.click(card.getByRole("button", { name: "Resolve" }));

      await noSignalAfter(slot, 2);
    });

    it("does not announce when the resolve after a post fails", async () => {
      signals = listenForSummaries();
      const slot = renderTabWith(
        { reply: () => ({ kind: "posted", pendingReviewUrl: null, resolveError: "rate limited" }) },
        threaded,
      );
      const card = await openCard(slot);

      typeReply(card);
      fireEvent.click(card.getByRole("button", { name: "Post + resolve" }));

      await noSignalAfter(slot, 3);
    });
  });

  it("keeps the reply text when a thread above it in the file gets resolved", async () => {
    const [first, second] = threaded.threads.placed;
    const sameFile = { ...second!, thread: { ...second!.thread, path: first!.thread.path } };
    const before: ReviewResult = {
      ...threaded,
      threads: { ...threaded.threads, placed: [first!, sameFile] },
    };
    const after: ReviewResult = {
      ...before,
      threads: {
        ...before.threads,
        placed: [{ ...first!, thread: { ...first!.thread, resolved: true } }, sameFile],
      },
    };
    const slot = renderTab(before, after);
    const card = await openCard(slot);
    typeReply(card, "Half written");

    await slot.behavior.emitRealtime("review.updated", { threadId: "thr_1" });

    await waitFor(() => expect(slot.getAllByTestId("line-annotation")).toHaveLength(1));
    const moved = within(slot.getByTestId("line-annotation"));
    expect((moved.getByRole("textbox", { name: "Reply" }) as HTMLTextAreaElement).value).toBe(
      "Half written",
    );
  });
});

const APP_TSX = "plugins/github-insight/app.tsx";

function commentDraft(id: string, overrides: Partial<ListedCommentDraft> = {}): ListedCommentDraft {
  return {
    id,
    path: APP_TSX,
    side: "RIGHT",
    line: 4,
    startLine: null,
    body: "Name the slot id",
    commitOid: "def456",
    updatedAt: 1,
    source: "agent",
    ...overrides,
  };
}

function withCommentDrafts(...commentDrafts: ListedCommentDraft[]): ReviewResult {
  return { ...recorded, commentDrafts };
}

async function findCommentDraft(slot: ReturnType<typeof renderTab>) {
  const card = await slot.findByRole("region", { name: "Pending comment" });
  return {
    card,
    box: within(card).getByRole("textbox", { name: "Comment" }) as HTMLTextAreaElement,
  };
}

describe("Files tab comment drafts", () => {
  it("shows a comment draft below its line on the new side, as 'Pending comment'", async () => {
    const slot = renderTab(withCommentDrafts(commentDraft("c1")));

    const { card, box } = await findCommentDraft(slot);
    expect(box.value).toBe("Name the slot id");
    const annotation = card.closest("[data-testid=line-annotation]") as HTMLElement;
    expect(annotation.dataset).toMatchObject({ side: "additions", line: "4" });
    expect(annotation.closest("[data-testid=file-diff]")!.getAttribute("data-path")).toBe(APP_TSX);
  });

  it("shows a draft on the old side on the deletions side", async () => {
    const slot = renderTab(withCommentDrafts(commentDraft("c1", { side: "LEFT" })));

    const { card } = await findCommentDraft(slot);
    expect((card.closest("[data-testid=line-annotation]") as HTMLElement).dataset.side).toBe(
      "deletions",
    );
  });

  it("names the range of a draft on more than one line", async () => {
    const slot = renderTab(withCommentDrafts(commentDraft("c1", { startLine: 2 })));

    const { card } = await findCommentDraft(slot);
    expect(within(card).getByText("Lines 2-4")).toBeTruthy();
  });

  it("shows a comment draft saved while the tab is open, loading only the drafts", async () => {
    const slot = renderTab(recorded, withCommentDrafts(commentDraft("c1")));
    await slot.findByText("3 files changed");

    await slot.behavior.emitRealtime("review.drafts-updated", { threadId: "thr_1" });

    expect((await findCommentDraft(slot)).box.value).toBe("Name the slot id");
    expect(methods(slot)).toEqual(["getReview", "getDrafts"]);
  });

  it("saves the last edit of a comment draft once the typing stops", async () => {
    const slot = renderTab(withCommentDrafts(commentDraft("c1")));
    const { box } = await findCommentDraft(slot);

    fireEvent.change(box, { target: { value: "Name" } });
    fireEvent.change(box, { target: { value: "Name the panel id" } });

    await waitFor(() => expect(callsTo(slot, "saveCommentDraft")).toHaveLength(1));
    expect(callsTo(slot, "saveCommentDraft")).toEqual([
      { threadId: "thr_1", draftId: "c1", body: "Name the panel id" },
    ]);
  });

  it("saves an unsaved comment edit when the tab closes", async () => {
    const slot = renderTab(withCommentDrafts(commentDraft("c1")));
    const { box } = await findCommentDraft(slot);

    fireEvent.change(box, { target: { value: "Name the panel id" } });
    slot.unmount();

    await waitFor(() =>
      expect(callsTo(slot, "saveCommentDraft")).toEqual([
        { threadId: "thr_1", draftId: "c1", body: "Name the panel id" },
      ]),
    );
  });

  it("keeps the edited comment when the tab loads the stored draft again", async () => {
    const slot = renderTab(withCommentDrafts(commentDraft("c1")));
    const { box } = await findCommentDraft(slot);

    fireEvent.change(box, { target: { value: "Name the panel id" } });
    await slot.behavior.emitRealtime("review.drafts-updated", { threadId: "thr_1" });

    await waitFor(() => expect(methods(slot)).toContain("getDrafts"));
    expect((await findCommentDraft(slot)).box.value).toBe("Name the panel id");
  });

  it("deletes a comment draft without a GitHub write, and loads only the drafts again", async () => {
    const slot = renderTab(withCommentDrafts(commentDraft("c1")), recorded);
    const { card } = await findCommentDraft(slot);

    fireEvent.click(within(card).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(methods(slot)).toEqual(["getReview", "deleteCommentDraft"]));
    await slot.behavior.emitRealtime("review.drafts-updated", { threadId: "thr_1" });

    await waitFor(() =>
      expect(methods(slot)).toEqual(["getReview", "deleteCommentDraft", "getDrafts"]),
    );
    await quietly();
    expect(slot.queryByRole("region", { name: "Pending comment" })).toBeNull();
    expect(callsTo(slot, "deleteCommentDraft")).toEqual([{ threadId: "thr_1", draftId: "c1" }]);
  });

  it("removes the comment draft before the delete returns", async () => {
    const slot = renderTabWith(
      { deleteCommentDraft: () => new Promise<ActionResult>(() => {}) },
      withCommentDrafts(commentDraft("c1")),
    );
    const { card } = await findCommentDraft(slot);

    fireEvent.click(within(card).getByRole("button", { name: "Delete" }));

    expect(slot.queryByRole("region", { name: "Pending comment" })).toBeNull();
  });

  it("keeps the comment draft and shows the error when the delete fails", async () => {
    const slot = renderTabWith(
      { deleteCommentDraft: () => ({ kind: "error", message: "No pull request for this thread" }) },
      withCommentDrafts(commentDraft("c1")),
    );
    const { card } = await findCommentDraft(slot);

    fireEvent.click(within(card).getByRole("button", { name: "Delete" }));

    expect((await slot.findByRole("alert")).textContent).toBe("No pull request for this thread");
    expect((await findCommentDraft(slot)).box.value).toBe("Name the slot id");
  });

  it("shows the error when a comment edit cannot be saved", async () => {
    const slot = renderTabWith(
      { saveCommentDraft: () => ({ kind: "error", message: "Comment draft c1 is gone" }) },
      withCommentDrafts(commentDraft("c1")),
    );
    const { card, box } = await findCommentDraft(slot);

    fireEvent.change(box, { target: { value: "Name the panel id" } });

    expect((await within(card).findByRole("alert")).textContent).toBe("Comment draft c1 is gone");
  });
});

describe("Files tab new comments", () => {
  const created = commentDraft("new1", { body: "", source: "user" });

  async function clickAdd(slot: ReturnType<typeof renderTab>, side: "additions" | "deletions") {
    const [diff] = await slot.findAllByTestId("file-diff");
    fireEvent.click(within(diff!).getByRole("button", { name: `+ ${side} 4` }));
  }

  it("creates a comment draft on the new side and focuses its box after the drafts reload", async () => {
    const slot = renderTab(recorded, withCommentDrafts(created));

    await clickAdd(slot, "additions");
    await waitFor(() => expect(callsTo(slot, "createCommentDraft")).toHaveLength(1));
    await slot.behavior.emitRealtime("review.drafts-updated", { threadId: "thr_1" });

    const { box } = await findCommentDraft(slot);
    await waitFor(() => expect(document.activeElement).toBe(box));
    expect(callsTo(slot, "createCommentDraft")).toEqual([
      { threadId: "thr_1", path: APP_TSX, side: "RIGHT", line: 4 },
    ]);
  });

  it("focuses the new box when the reload shows the draft before the create returns", async () => {
    let finishCreate: (result: CreateCommentDraftResult) => void = () => {};
    const slot = renderTabWith(
      { createCommentDraft: () => new Promise((resolve) => (finishCreate = resolve)) },
      recorded,
      withCommentDrafts(created),
    );

    await clickAdd(slot, "additions");
    await slot.behavior.emitRealtime("review.drafts-updated", { threadId: "thr_1" });
    const { box } = await findCommentDraft(slot);
    await act(async () => finishCreate({ kind: "created", draftId: "new1" }));

    await waitFor(() => expect(document.activeElement).toBe(box));
  });

  it("creates a comment draft on the old side for a deleted line", async () => {
    const slot = renderTab(recorded);

    await clickAdd(slot, "deletions");

    await waitFor(() =>
      expect(callsTo(slot, "createCommentDraft")).toEqual([
        { threadId: "thr_1", path: APP_TSX, side: "LEFT", line: 4 },
      ]),
    );
  });

  it("shows the error when the comment cannot be created", async () => {
    const slot = renderTabWith(
      { createCommentDraft: () => ({ kind: "error", message: "Line 4 is not in the diff" }) },
      recorded,
    );

    await clickAdd(slot, "additions");

    expect((await slot.findByRole("alert")).textContent).toBe("Line 4 is not in the diff");
  });

  it("has no add-comment gutter on a merged pull request", async () => {
    const slot = renderTab({ ...recorded, head: { ...recorded.head, state: "MERGED" } });

    const diffs = await slot.findAllByTestId("file-diff");
    expect(diffs.map((diff) => diff.dataset.gutterUtility)).not.toContain("true");
  });

  it("has no add-comment gutter while comment drafts are on an older commit", async () => {
    const slot = renderTab(withCommentDrafts(commentDraft("c1", { commitOid: "abc123" })));

    const diffs = await slot.findAllByTestId("file-diff");
    expect(diffs.map((diff) => diff.dataset.gutterUtility)).not.toContain("true");
  });
});

describe("Files tab new comment glow", () => {
  const FIRST = "PRRC_kwDOHI7l-87xQrkh";
  const REPLY = "PRRC_kwDOHI7l-87xSFQS";
  const OPEN_THREAD = "PRRT_kwDOHI7l-86jxula";
  const DATABRICKS =
    "apps/shell/e2e/catalog/integrations/components/asset/generic-configuration/createDatabricksOutboundSyncConfigurationComponent.ts";
  const watchedComments = new Map<Element, IntersectionObserverCallback>();
  let threadCount = 0;

  class WatchComments {
    constructor(private readonly callback: IntersectionObserverCallback) {}
    observe(target: Element) {
      if (target.hasAttribute("data-review-comment-id")) {
        watchedComments.set(target, this.callback);
        return;
      }
      this.callback(
        [{ isIntersecting: true, target } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      );
    }
    disconnect() {}
  }

  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", WatchComments);
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
  });

  afterEach(() => {
    vi.stubGlobal("IntersectionObserver", VisibleAtOnce);
    vi.restoreAllMocks();
    vi.useRealTimers();
    watchedComments.clear();
  });

  function withNew(result: ReviewResult, ...newCommentIds: string[]): ReviewResult {
    return { ...result, newCommentIds } as ReviewResult;
  }

  function resolved(threadId: string): ReviewResult {
    return {
      ...threaded,
      threads: {
        placed: threaded.threads.placed.map((placed) =>
          placed.thread.id === threadId
            ? { ...placed, thread: { ...placed.thread, resolved: true } }
            : placed,
        ),
        outdated: threaded.threads.outdated,
      },
    };
  }

  function renderGlow(handlers: RpcHandlers, ...results: ReviewResult[]) {
    return renderTabFor(`thr_glow_${++threadCount}`, handlers, ...results);
  }

  function commentOf(slot: ReturnType<typeof renderTab>, id: string) {
    return slot.container.querySelector<HTMLElement>(`[data-review-comment-id="${id}"]`);
  }

  function readFor(ms: number, ...elements: HTMLElement[]) {
    vi.useFakeTimers();
    act(() => {
      for (const element of elements) {
        watchedComments.get(element)?.(
          [
            {
              isIntersecting: true,
              intersectionRatio: 1,
              target: element,
            } as unknown as IntersectionObserverEntry,
          ],
          {} as IntersectionObserver,
        );
      }
      vi.advanceTimersByTime(ms);
    });
    vi.useRealTimers();
  }

  it("glows only the new reply of a thread", async () => {
    const slot = renderGlow({}, withNew(threaded, REPLY));

    await waitFor(() => expect(commentOf(slot, REPLY)).not.toBeNull());
    expect(commentOf(slot, REPLY)!.classList).toContain("review-comment-new");
    expect(commentOf(slot, FIRST)!.classList).not.toContain("review-comment-new");
  });

  it("shows no glow when nothing is new", async () => {
    const slot = renderGlow({}, threaded);

    await waitFor(() => expect(commentOf(slot, REPLY)).not.toBeNull());
    expect(slot.container.querySelector(".review-comment-new")).toBeNull();
  });

  it("saves the comment as seen after the user reads it and keeps the glow", async () => {
    const slot = renderGlow({}, withNew(threaded, REPLY));
    await waitFor(() => expect(commentOf(slot, REPLY)).not.toBeNull());

    readFor(1800, commentOf(slot, REPLY)!);

    expect(commentOf(slot, REPLY)!.classList).toContain("review-comment-new");
    await waitFor(() =>
      expect(callsTo(slot, "markCommentsSeen")).toEqual([
        { threadId: `thr_glow_${threadCount}`, commentIds: [REPLY] },
      ]),
    );
  });

  it("does not save a comment that the user scrolls past", async () => {
    const slot = renderGlow({}, withNew(threaded, REPLY));
    await waitFor(() => expect(commentOf(slot, REPLY)).not.toBeNull());

    readFor(500, commentOf(slot, REPLY)!);

    expect(callsTo(slot, "markCommentsSeen")).toEqual([]);
  });

  it("keeps the glow when a reload no longer lists the comment as new", async () => {
    const threadId = `thr_glow_${++threadCount}`;
    const slot = renderTabFor(threadId, {}, withNew(threaded, REPLY), threaded);
    await waitFor(() => expect(commentOf(slot, REPLY)).not.toBeNull());

    await slot.behavior.emitRealtime("review.updated", { threadId });
    await waitFor(() => expect(methods(slot).filter((m) => m === "getReview")).toHaveLength(2));
    await quietly();

    expect(commentOf(slot, REPLY)!.classList).toContain("review-comment-new");
  });

  it("does not try again to save a comment that failed to save", async () => {
    const slot = renderGlow(
      { markCommentsSeen: () => ({ kind: "error", message: "disk full" }) },
      withNew(threaded, REPLY),
    );
    await waitFor(() => expect(commentOf(slot, REPLY)).not.toBeNull());
    readFor(1800, commentOf(slot, REPLY)!);
    await waitFor(() => expect(callsTo(slot, "markCommentsSeen")).toHaveLength(1));

    readFor(1800, commentOf(slot, REPLY)!);
    await quietly();

    expect(callsTo(slot, "markCommentsSeen")).toHaveLength(1);
  });

  it("saves comments seen close together in one call", async () => {
    const slot = renderGlow({}, withNew(threaded, FIRST, REPLY));
    await waitFor(() => expect(commentOf(slot, REPLY)).not.toBeNull());

    readFor(1800, commentOf(slot, FIRST)!, commentOf(slot, REPLY)!);

    await waitFor(() =>
      expect(callsTo(slot, "markCommentsSeen")).toEqual([
        { threadId: `thr_glow_${threadCount}`, commentIds: [FIRST, REPLY] },
      ]),
    );
  });

  it("saves a seen comment when the tab closes before the save delay", async () => {
    const slot = renderGlow({}, withNew(threaded, REPLY));
    await waitFor(() => expect(commentOf(slot, REPLY)).not.toBeNull());

    readFor(1500, commentOf(slot, REPLY)!);
    slot.unmount();

    expect(callsTo(slot, "markCommentsSeen")).toEqual([
      { threadId: `thr_glow_${threadCount}`, commentIds: [REPLY] },
    ]);
  });

  it("expands a shown resolved thread when a refresh brings a new reply", async () => {
    const threadId = `thr_glow_${++threadCount}`;
    const slot = renderTabFor(
      threadId,
      {},
      resolved(OPEN_THREAD),
      withNew(resolved(OPEN_THREAD), REPLY),
    );
    fireEvent.click(await slot.findByRole("checkbox", { name: "Show resolved" }));
    expect(commentOf(slot, REPLY)).toBeNull();

    await slot.behavior.emitRealtime("review.updated", { threadId });

    await waitFor(() => expect(commentOf(slot, REPLY)).not.toBeNull());
  });

  it("shows and expands a resolved thread with a new reply when 'Show resolved' is off", async () => {
    const slot = renderGlow({}, withNew(resolved(OPEN_THREAD), REPLY));

    await waitFor(() => expect(commentOf(slot, REPLY)).not.toBeNull());
    expect(
      (slot.getByRole("checkbox", { name: "Show resolved" }) as HTMLInputElement).checked,
    ).toBe(false);
  });

  it("hides a resolved thread with no new comment when 'Show resolved' is off", async () => {
    const slot = renderGlow({}, resolved(OPEN_THREAD));

    await slot.findAllByTestId("file-diff");
    expect(commentOf(slot, REPLY)).toBeNull();
  });

  it("starts a viewed file with a new comment expanded", async () => {
    const identity = fileIdentity(threaded.files.find((file) => file.path === DATABRICKS)!)!;
    const viewed = { ...threaded, viewedMarks: { [DATABRICKS]: identity } };
    const slot = renderGlow({}, withNew(viewed, REPLY));

    const diff = (await slot.findAllByTestId("file-diff")).find(
      (candidate) => candidate.getAttribute("data-path") === DATABRICKS,
    )!;
    expect(diff.dataset.collapsed).toBe("false");
    expect(
      (slot.getByRole("checkbox", { name: `Viewed ${DATABRICKS}` }) as HTMLInputElement).checked,
    ).toBe(true);
  });
});

describe("Files tab drafts on an older commit", () => {
  const older = commentDraft("c1", { commitOid: "abc123", side: "LEFT", startLine: 2 });

  it("warns with both commits and lists the drafts above the files, not on their lines", async () => {
    const slot = renderTab(withCommentDrafts(older));

    const section = await slot.findByRole("region", { name: "Drafts on an older commit" });
    expect(
      within(section).getByText("PR has new commits since these drafts (abc123 -> def456)"),
    ).toBeTruthy();
    expect(
      within(section).getByText("Submit or delete these drafts to add new comments."),
    ).toBeTruthy();
    const card = within(section).getByRole("region", { name: "Pending comment" });
    expect(within(card).getByText(APP_TSX)).toBeTruthy();
    expect(within(card).getByText("Old side")).toBeTruthy();
    expect(within(card).getByText("Lines 2-4")).toBeTruthy();
    expect(
      (within(card).getByRole("textbox", { name: "Comment" }) as HTMLTextAreaElement).value,
    ).toBe("Name the slot id");
    const [firstDiff] = await slot.findAllByTestId("file-diff");
    expect(
      section.compareDocumentPosition(firstDiff!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(slot.queryAllByTestId("line-annotation")).toEqual([]);
  });

  it("has no older-commit section when all drafts are at the head", async () => {
    const slot = renderTab(withCommentDrafts(commentDraft("c1")));

    await findCommentDraft(slot);
    expect(slot.queryByRole("region", { name: "Drafts on an older commit" })).toBeNull();
  });
});

describe("Files tab submit panel", () => {
  const summary = { body: "Looks good overall", updatedAt: 5, source: "agent" as const };
  const ownPr = { ...recorded, head: { ...recorded.head, viewerIsAuthor: true } };
  const merged = {
    ...withCommentDrafts(commentDraft("c1")),
    head: { ...recorded.head, state: "MERGED" as const },
  };
  const withDraftsAndSummary = {
    ...withCommentDrafts(commentDraft("c1"), commentDraft("c2")),
    summaryDraft: summary,
  };

  async function openPanel(slot: ReturnType<typeof renderTab>) {
    const toggle = await slot.findByRole("button", { name: "Submit review" });
    if (toggle.getAttribute("aria-expanded") !== "true") fireEvent.click(toggle);
    return within(slot.getByRole("region", { name: "Submit review" }));
  }

  function verdicts(panel: ReturnType<typeof within>) {
    return panel
      .getAllByRole("radio")
      .map((radio: HTMLElement) => radio.closest("label")!.textContent);
  }

  function submitButton(panel: ReturnType<typeof within>) {
    return panel.getByRole("button", { name: "Submit" }) as HTMLButtonElement;
  }

  function summaryBox(panel: ReturnType<typeof within>) {
    return panel.getByRole("textbox", { name: "Summary" }) as HTMLTextAreaElement;
  }

  it("is closed when there are no drafts, and opens from the header", async () => {
    const slot = renderTab(recorded);

    const toggle = await slot.findByRole("button", { name: "Submit review" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(slot.queryByRole("region", { name: "Submit review" })).toBeNull();
    fireEvent.click(toggle);

    expect(slot.getByRole("region", { name: "Submit review" })).toBeTruthy();
  });

  it("is open with the summary draft and the number of comment drafts", async () => {
    const slot = renderTab(withDraftsAndSummary);

    const panel = await openPanel(slot);
    expect(slot.getByRole("button", { name: "Submit review" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(summaryBox(panel).value).toBe("Looks good overall");
    expect(panel.getByText("2 comments")).toBeTruthy();
  });

  it("counts only the comment drafts with text", async () => {
    const slot = renderTab(
      withCommentDrafts(commentDraft("c1", { body: " " }), commentDraft("c2")),
    );

    const panel = await openPanel(slot);

    expect(panel.getByText("1 comment")).toBeTruthy();
    expect(submitButton(panel).disabled).toBe(false);
  });

  it("counts an empty comment draft once the user types in it", async () => {
    const slot = renderTab(withCommentDrafts(commentDraft("c1", { body: "" })));
    const panel = await openPanel(slot);
    expect(panel.getByText("0 comments")).toBeTruthy();
    expect(submitButton(panel).disabled).toBe(true);

    fireEvent.change((await findCommentDraft(slot)).box, { target: { value: "Rename this" } });

    expect(panel.getByText("1 comment")).toBeTruthy();
    expect(submitButton(panel).disabled).toBe(false);
  });

  it("shows Comment, Approve, and Request changes on another person's PR", async () => {
    const slot = renderTab(recorded);

    expect(verdicts(await openPanel(slot))).toEqual(["Comment", "Approve", "Request changes"]);
  });

  it("shows only Comment on the user's own PR", async () => {
    const slot = renderTab(ownPr);

    expect(verdicts(await openPanel(slot))).toEqual(["Comment"]);
  });

  it("disables Request changes without a summary, with the reason", async () => {
    const slot = renderTab(withCommentDrafts(commentDraft("c1")));
    const panel = await openPanel(slot);

    fireEvent.click(panel.getByRole("radio", { name: "Request changes" }));

    expect(submitButton(panel).disabled).toBe(true);
    expect(panel.getByText("Add a summary to request changes")).toBeTruthy();
    fireEvent.change(summaryBox(panel), { target: { value: "Fix the null check" } });
    expect(submitButton(panel).disabled).toBe(false);
  });

  it("disables Comment with no summary and no comment drafts", async () => {
    const slot = renderTab(recorded);
    const panel = await openPanel(slot);

    expect(submitButton(panel).disabled).toBe(true);
    expect(panel.getByText("Add a summary or a comment")).toBeTruthy();
  });

  it("saves the summary once the typing stops", async () => {
    const slot = renderTab(recorded);
    const panel = await openPanel(slot);

    fireEvent.change(summaryBox(panel), { target: { value: "Looks" } });
    fireEvent.change(summaryBox(panel), { target: { value: "Looks good" } });

    await waitFor(() =>
      expect(callsTo(slot, "saveSummaryDraft")).toEqual([
        { threadId: "thr_1", body: "Looks good" },
      ]),
    );
  });

  it("keeps the typed summary when the panel closes and opens again", async () => {
    const slot = renderTab(recorded);
    const panel = await openPanel(slot);

    fireEvent.change(summaryBox(panel), { target: { value: "Looks good" } });
    fireEvent.click(slot.getByRole("button", { name: "Submit review" }));
    fireEvent.click(slot.getByRole("button", { name: "Submit review" }));

    expect(summaryBox(within(slot.getByRole("region", { name: "Submit review" }))).value).toBe(
      "Looks good",
    );
  });

  it("saves the edits first, submits the verdict and the summary, and shows no drafts after", async () => {
    const signals = listenForSummaries();
    const slot = renderTab(withDraftsAndSummary, recorded);
    const panel = await openPanel(slot);
    const box = within(
      (await slot.findAllByRole("region", { name: "Pending comment" }))[0]!,
    ).getByRole("textbox", { name: "Comment" });

    fireEvent.change(box, { target: { value: "Edited comment" } });
    fireEvent.change(summaryBox(panel), { target: { value: "Ship it" } });
    fireEvent.click(panel.getByRole("radio", { name: "Approve" }));
    fireEvent.click(submitButton(panel));

    expect(await panel.findByText("Review submitted")).toBeTruthy();
    await waitFor(() => expect(slot.queryByRole("region", { name: "Pending comment" })).toBeNull());
    expect(summaryBox(panel).value).toBe("");
    expect(methods(slot)).toEqual([
      "getReview",
      "saveSummaryDraft",
      "saveCommentDraft",
      "submitReview",
      "getReview",
    ]);
    expect(callsTo(slot, "submitReview")).toEqual([
      { threadId: "thr_1", event: "APPROVE", body: "Ship it" },
    ]);
    await waitFor(() => expect(signals).toEqual([{ threadId: "thr_1" }]));
    stopListening();
  });

  it("shows the GitHub error with a link to the PR and keeps the drafts and the summary", async () => {
    const slot = renderTabWith(
      {
        submitReview: () => ({
          kind: "error",
          message: "You have a pending review on GitHub. Submit or delete it there first.",
          url: "https://github.com/koenvangeert/bb-plugins/pull/1",
        }),
      },
      withDraftsAndSummary,
    );
    const panel = await openPanel(slot);

    fireEvent.click(submitButton(panel));

    const alert = await panel.findByRole("alert");
    expect(alert.textContent).toContain("You have a pending review on GitHub.");
    expect(within(alert).getByRole("link", { name: "Open the PR" }).getAttribute("href")).toBe(
      "https://github.com/koenvangeert/bb-plugins/pull/1",
    );
    expect(slot.getAllByRole("region", { name: "Pending comment" })).toHaveLength(2);
    expect(summaryBox(panel).value).toBe("Looks good overall");
    expect(methods(slot)).toEqual(["getReview", "submitReview"]);
  });

  it("tells the user to mark the PR reviewed by hand when the mark after a submit fails", async () => {
    const slot = renderTabWith(
      { submitReview: () => ({ kind: "submitted", markError: "disk full" }) },
      withDraftsAndSummary,
    );
    const panel = await openPanel(slot);

    fireEvent.click(submitButton(panel));

    expect(await panel.findByText("Review submitted")).toBeTruthy();
    expect((await panel.findByRole("alert")).textContent).toBe(
      'Could not mark the PR reviewed: disk full. Use "Mark reviewed" in the Pull Requests panel.',
    );
  });

  it("shows an error without a link when there is no PR url", async () => {
    const slot = renderTabWith(
      { submitReview: () => ({ kind: "error", message: "gh not logged in", url: null }) },
      withDraftsAndSummary,
    );
    const panel = await openPanel(slot);

    fireEvent.click(submitButton(panel));

    const alert = await panel.findByRole("alert");
    expect(alert.textContent).toBe("gh not logged in");
    expect(within(alert).queryByRole("link")).toBeNull();
  });

  it("shows the drafts of a merged PR and disables submit", async () => {
    const slot = renderTab(merged);
    const panel = await openPanel(slot);

    expect(await slot.findByRole("region", { name: "Pending comment" })).toBeTruthy();
    expect(submitButton(panel).disabled).toBe(true);
    expect(panel.getByText("Pull request is merged")).toBeTruthy();
  });
});

describe("Files tab palette commands", () => {
  const submitRegion = (slot: ReturnType<typeof renderTab>) =>
    slot.queryByRole("region", { name: "Submit review" });

  it("opens the submit panel once the review has loaded", async () => {
    postIntent("thr_1", "files", "submit");
    const slot = renderTab(recorded);

    expect(await slot.findByRole("region", { name: "Submit review" })).toBeTruthy();
    expect(callsTo(slot, "submitReview")).toEqual([]);
  });

  it("keeps an open panel open with the typed summary", async () => {
    const slot = renderTab(recorded);
    fireEvent.click(await slot.findByRole("button", { name: "Submit review" }));
    const summary = within(submitRegion(slot)!).getByRole("textbox", {
      name: "Summary",
    }) as HTMLTextAreaElement;
    fireEvent.change(summary, { target: { value: "Looks good" } });

    await act(async () => postIntent("thr_1", "files", "submit"));

    expect(
      (within(submitRegion(slot)!).getByRole("textbox", { name: "Summary" }) as HTMLTextAreaElement)
        .value,
    ).toBe("Looks good");
  });

  it("drops the request when the thread has no PR yet", async () => {
    postIntent("thr_1", "files", "submit");
    const slot = renderTab({ kind: "no_pr" }, recorded);
    await slot.findByText("No pull request for this thread");

    await slot.behavior.emitRealtime("review.updated", { threadId: "thr_1" });
    await slot.findByRole("button", { name: "Submit review" });
    await act(quietly);

    expect(submitRegion(slot)).toBeNull();
  });

  it("does not open the panel again when the tab mounts again", async () => {
    postIntent("thr_1", "files", "submit");
    const first = renderTab(recorded);
    await first.findByRole("region", { name: "Submit review" });
    first.unmount();

    const second = renderTab(recorded);
    await second.findByRole("button", { name: "Submit review" });
    await act(quietly);

    expect(submitRegion(second)).toBeNull();
  });
});

describe("Files tab viewer review", () => {
  function reviewedAt(commitOid: string, state: "APPROVED" | "CHANGES_REQUESTED" = "APPROVED") {
    return {
      ...recorded,
      head: {
        ...recorded.head,
        viewerReview: { state, submittedAt: new Date().toISOString(), commitOid },
      },
    } satisfies ReviewResult;
  }

  it("shows the viewer's last verdict on the current head", async () => {
    const slot = renderTab(reviewedAt("def456"));

    expect(await slot.findByText("You approved")).toBeTruthy();
    expect(slot.queryByText("new commits since")).toBeNull();
  });

  it("flags commits pushed after the viewer's last review", async () => {
    const slot = renderTab(reviewedAt("abc123", "CHANGES_REQUESTED"));

    expect(await slot.findByText("You requested changes")).toBeTruthy();
    expect(slot.getByText("new commits since")).toBeTruthy();
  });

  it("shows no verdict before the viewer reviews", async () => {
    const slot = renderTab(recorded);

    await slot.findByText("3 files changed");
    expect(slot.queryByText(/^You /)).toBeNull();
  });

  it("shows the new verdict after a submit", async () => {
    const slot = renderTab(recorded, reviewedAt("def456"));
    fireEvent.click(await slot.findByRole("button", { name: "Submit review" }));
    const panel = within(slot.getByRole("region", { name: "Submit review" }));

    fireEvent.click(panel.getByRole("radio", { name: "Approve" }));
    fireEvent.click(panel.getByRole("button", { name: "Submit" }));

    expect(await slot.findByText("You approved")).toBeTruthy();
    expect(panel.getByRole("button", { name: "Submitted" })).toBeTruthy();
  });
});

describe("Files tab comment navigation", () => {
  const AREA_TOP = 100;
  const MOUNTED_HEIGHT = 1000;
  const UNMOUNTED_HEIGHT = 40;
  const LINE_HEIGHT = 100;
  const FILE_HEADER_HEIGHT = 40;
  const cardTop = (offset: number) => offset - FILE_HEADER_HEIGHT - 8;
  const PATCH = ["@@ -1,4 +1,4 @@", " a", "-b", "+c", " d", " e"].join("\n");
  const files: ReviewFile[] = ["a.ts", "b.ts", "c.ts"].map((path) => ({
    path,
    previousPath: null,
    status: "modified",
    patch: PATCH,
  }));

  function reviewThread(id: string, path: string, line: number, resolved = false): ReviewThread {
    return {
      id,
      resolved,
      outdated: false,
      path,
      line,
      originalLine: line,
      side: "RIGHT",
      comments: [
        {
          id: `${id}-c`,
          author: "alice",
          avatarUrl: null,
          body: `Comment ${id}`,
          createdAt: "2026-01-01T00:00:00Z",
          url: "https://github.com/o/r/pull/1",
          diffHunk: "",
        },
      ],
      hasMoreComments: false,
    };
  }

  function review(threads: ReviewThread[], drafts: ListedCommentDraft[] = []): ReviewResult {
    return {
      kind: "ok",
      files,
      threads: placeThreads(files, threads),
      drafts: {},
      ...noReviewDrafts,
      commentDrafts: drafts,
    };
  }

  const standard = review(
    [reviewThread("t1", "a.ts", 2), reviewThread("t2", "c.ts", 1)],
    [commentDraft("d1", { path: "a.ts", line: 3, body: "" })],
  );

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
      toJSON() {},
    };
  }

  function sectionOffset(area: HTMLElement, section: HTMLElement): number {
    let offset = 0;
    for (const other of Array.from(area.querySelectorAll<HTMLElement>("section[data-path]"))) {
      if (other === section) return offset;
      offset += other.querySelector("[data-testid=file-diff]") ? MOUNTED_HEIGHT : UNMOUNTED_HEIGHT;
    }
    return offset;
  }

  function contentOffset(area: HTMLElement, element: HTMLElement): number {
    if (element.matches("section[data-path]")) return sectionOffset(area, element);
    const section = element.closest<HTMLElement>("section[data-path]");
    const line = element.closest<HTMLElement>("[data-line]");
    if (section === null || line === null) return 0;
    return sectionOffset(area, section) + Number(line.dataset.line) * LINE_HEIGHT;
  }

  const pendingReveals = new Map<Element, IntersectionObserverCallback>();

  class RevealOnRequest {
    constructor(private readonly callback: IntersectionObserverCallback) {}
    observe(target: Element) {
      pendingReveals.set(target, this.callback);
    }
    disconnect() {}
  }

  function reveal(area: HTMLElement, path: string) {
    const section = area.querySelector(`section[data-path="${path}"]`)!;
    act(() => {
      pendingReveals.get(section)?.(
        [{ isIntersecting: true, target: section } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });
  }

  function resize() {
    act(() => {
      for (const callback of resizeCallbacks) callback([], {} as ResizeObserver);
    });
  }

  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.matches("[data-diff-scroll-area]")) return rect(AREA_TOP, 600);
      if (this.matches("[data-diffs-header]")) return rect(0, FILE_HEADER_HEIGHT);
      const area = this.closest<HTMLElement>("[data-diff-scroll-area]");
      if (area === null) return rect(0, 0);
      return rect(AREA_TOP + contentOffset(area, this) - area.scrollTop, LINE_HEIGHT);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.stubGlobal("IntersectionObserver", VisibleAtOnce);
    pendingReveals.clear();
  });

  async function renderNavigation(result: ReviewResult) {
    const slot = renderTab(result);
    await slot.findByText(/files? changed/);
    const area = slot.container.querySelector<HTMLElement>("[data-diff-scroll-area]")!;
    return Object.assign(slot, {
      area,
      stepper: () => within(slot.getByRole("group", { name: "Comment navigation" })),
      next: () => fireEvent.click(slot.getByRole("button", { name: "Next comment" })),
      previous: () => fireEvent.click(slot.getByRole("button", { name: "Previous comment" })),
      scrollTo(top: number) {
        area.scrollTop = top;
        fireEvent.scroll(area);
      },
    });
  }

  it("marks each file section and comment card for the jump", async () => {
    const slot = await renderNavigation(standard);
    await slot.findAllByTestId("file-diff");

    expect(slot.area.querySelector('section[data-path="a.ts"]')).not.toBeNull();
    expect(slot.area.querySelector('[data-review-thread-id="t1"]')?.textContent).toContain(
      "Comment t1",
    );
    expect(slot.area.querySelector('[data-comment-draft-id="d1"]')?.textContent).toContain(
      "Pending comment",
    );
  });

  it("counts comment drafts and open threads together", async () => {
    const slot = await renderNavigation(standard);

    expect(slot.stepper().getByText("1 / 3")).toBeTruthy();
  });

  it("has no stepper when there are no comments", async () => {
    const slot = await renderNavigation(review([]));

    expect(slot.queryByRole("group", { name: "Comment navigation" })).toBeNull();
    expect(slot.queryByRole("button", { name: "Next comment" })).toBeNull();
  });

  it("counts resolved threads only when 'Show resolved' is on", async () => {
    const slot = await renderNavigation(
      review([reviewThread("t1", "a.ts", 2), reviewThread("done", "b.ts", 1, true)]),
    );
    expect(slot.stepper().getByText("1 / 1")).toBeTruthy();

    fireEvent.click(slot.getByRole("checkbox", { name: "Show resolved" }));

    expect(slot.stepper().getByText("1 / 2")).toBeTruthy();
  });

  it("shows the first comment at or below the top as the user scrolls", async () => {
    const slot = await renderNavigation(standard);

    slot.scrollTo(250);

    await waitFor(() => expect(slot.stepper().getByText("2 / 3")).toBeTruthy());
  });

  it("uses the file position for a comment whose diff has not loaded", async () => {
    vi.stubGlobal("IntersectionObserver", RevealOnRequest);
    const slot = await renderNavigation(
      review([
        reviewThread("t1", "a.ts", 2),
        reviewThread("tb", "b.ts", 4),
        reviewThread("t2", "c.ts", 1),
      ]),
    );

    slot.scrollTo(UNMOUNTED_HEIGHT);

    await waitFor(() => expect(slot.stepper().getByText("2 / 3")).toBeTruthy());
  });

  it("jumps to the next comment when the current one is at the top", async () => {
    const slot = await renderNavigation(standard);
    slot.scrollTo(cardTop(200));

    slot.next();

    expect(slot.area.scrollTop).toBe(cardTop(300));
    expect(slot.stepper().getByText("2 / 3")).toBeTruthy();
  });

  it("jumps to the current comment when it is below the top after a manual scroll", async () => {
    const slot = await renderNavigation(standard);
    slot.scrollTo(250);

    slot.next();

    expect(slot.area.scrollTop).toBe(cardTop(300));
  });

  it("goes back to the comment above the top", async () => {
    const slot = await renderNavigation(standard);
    slot.scrollTo(250);

    slot.previous();

    expect(slot.area.scrollTop).toBe(cardTop(200));
    expect(slot.stepper().getByText("1 / 3")).toBeTruthy();
  });

  it("wraps from the first comment to the last, and back", async () => {
    const slot = await renderNavigation(standard);
    slot.scrollTo(cardTop(200));

    slot.previous();
    expect(slot.area.scrollTop).toBe(cardTop(2100));
    expect(slot.stepper().getByText("3 / 3")).toBeTruthy();

    slot.next();
    expect(slot.area.scrollTop).toBe(cardTop(200));
  });

  it("goes to the first comment on next, and the last on previous, when scrolled past all", async () => {
    const slot = await renderNavigation(standard);
    slot.scrollTo(2500);
    await waitFor(() => expect(slot.stepper().getByText("3 / 3")).toBeTruthy());

    slot.next();
    expect(slot.area.scrollTop).toBe(cardTop(200));

    slot.scrollTo(2500);
    fireEvent.wheel(slot.area);
    slot.previous();
    expect(slot.area.scrollTop).toBe(cardTop(2100));
  });

  const farThreads = () =>
    review([
      reviewThread("t1", "a.ts", 2),
      reviewThread("tb", "b.ts", 4),
      reviewThread("t2", "c.ts", 1),
    ]);

  it("jumps to the first comment of a file at the top whose diff has not loaded", async () => {
    vi.stubGlobal("IntersectionObserver", RevealOnRequest);
    const slot = await renderNavigation(farThreads());

    slot.next();

    expect(slot.area.scrollTop).toBe(0);
    expect(slot.stepper().getByText("1 / 3")).toBeTruthy();
  });

  it("lands on a card whose diff loads after the jump, and highlights it for a short time", async () => {
    vi.stubGlobal("IntersectionObserver", RevealOnRequest);
    const slot = await renderNavigation(farThreads());
    slot.scrollTo(UNMOUNTED_HEIGHT);

    slot.next();
    expect(slot.area.scrollTop).toBe(UNMOUNTED_HEIGHT);

    vi.useFakeTimers();
    reveal(slot.area, "b.ts");
    resize();
    const card = slot.area.querySelector<HTMLElement>('[data-review-thread-id="tb"]')!;
    expect(slot.area.scrollTop).toBe(cardTop(UNMOUNTED_HEIGHT + 4 * LINE_HEIGHT));
    expect(card.hasAttribute("data-jumped")).toBe(true);

    act(() => vi.advanceTimersByTime(1500));
    expect(card.hasAttribute("data-jumped")).toBe(false);
  });

  it("stops holding the jumped comment when the user turns the wheel", async () => {
    vi.stubGlobal("IntersectionObserver", RevealOnRequest);
    const slot = await renderNavigation(farThreads());
    slot.scrollTo(UNMOUNTED_HEIGHT);
    slot.next();

    fireEvent.wheel(slot.area);
    reveal(slot.area, "b.ts");
    resize();

    expect(slot.area.scrollTop).toBe(UNMOUNTED_HEIGHT);
  });

  it("jumps from a palette request posted before the review loaded, without the submit panel", async () => {
    postIntent("thr_1", "files", "next-comment");
    const slot = await renderNavigation(farThreads());
    resize();

    await waitFor(() => expect(slot.area.scrollTop).toBe(cardTop(2 * LINE_HEIGHT)));
    expect(slot.queryByRole("region", { name: "Submit review" })).toBeNull();
  });

  it("jumps on a palette request while the tab is open", async () => {
    const slot = await renderNavigation(standard);
    await slot.findAllByTestId("file-diff");

    act(() => postIntent("thr_1", "files", "previous-comment"));

    expect(slot.area.scrollTop).toBe(cardTop(2100));
  });

  it("drops a palette request that comes after a failed load", async () => {
    const slot = renderTab({ kind: "error", message: "gh failed" }, standard);
    await slot.findByText("gh failed");

    act(() => postIntent("thr_1", "files", "next-comment"));
    fireEvent.click(slot.getByRole("button", { name: /Retry/ }));
    await slot.findByRole("group", { name: "Comment navigation" });
    await act(quietly);
    resize();

    const area = slot.container.querySelector<HTMLElement>("[data-diff-scroll-area]")!;
    expect(area.scrollTop).toBe(0);
  });

  it("steps from the jumped comment after the list changes during the jump", async () => {
    const slot = await renderNavigation(
      review([
        reviewThread("done", "a.ts", 1, true),
        reviewThread("t1", "a.ts", 2),
        reviewThread("t2", "c.ts", 1),
      ]),
    );
    slot.next();
    expect(slot.stepper().getByText("1 / 2")).toBeTruthy();

    fireEvent.click(slot.getByRole("checkbox", { name: "Show resolved" }));
    expect(slot.stepper().getByText("2 / 3")).toBeTruthy();

    slot.next();
    expect(slot.area.scrollTop).toBe(cardTop(2100));
  });

  it("does not scroll on a palette request when there are no comments", async () => {
    postIntent("thr_1", "files", "next-comment");
    const slot = await renderNavigation(review([]));
    await act(quietly);

    expect(slot.area.scrollTop).toBe(0);
  });

  it("keeps the typed text of a draft across a jump", async () => {
    const slot = await renderNavigation(standard);
    const box = within(
      slot.area.querySelector<HTMLElement>('[data-comment-draft-id="d1"]')!,
    ).getByRole("textbox", { name: "Comment" }) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "Half typed" } });

    slot.next();
    slot.next();

    expect(box.value).toBe("Half typed");
  });
});
