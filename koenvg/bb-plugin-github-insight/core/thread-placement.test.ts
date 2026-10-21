import { describe, expect, it } from "vitest";
import recordedFiles from "../test/fixtures/pr-25259-files.json";
import recordedThreads from "../test/fixtures/pr-25259-review-threads.json";
import { parsePrFiles, type ReviewFile } from "./pr-files";
import { parseReviewThreads, type ReviewThread } from "./review-threads";
import { commentHolders, openThreadCounts, placeThreads, visibleThreads } from "./thread-placement";

const file: ReviewFile = {
  path: "src/a.ts",
  previousPath: null,
  status: "modified",
  patch: ["@@ -10,3 +10,4 @@", " keep", "-old", "+new", "+added", " tail"].join("\n"),
};

function thread(fields: Partial<ReviewThread>): ReviewThread {
  return {
    id: "t1",
    resolved: false,
    outdated: false,
    path: "src/a.ts",
    line: 11,
    originalLine: 11,
    side: "RIGHT",
    comments: [],
    hasMoreComments: false,
    ...fields,
  };
}

describe("placeThreads", () => {
  it("puts a RIGHT thread on the additions side of its line", () => {
    const placement = placeThreads([file], [thread({ side: "RIGHT", line: 12 })]);

    expect(placement.placed).toEqual([
      { thread: expect.objectContaining({ id: "t1" }), side: "additions", lineNumber: 12 },
    ]);
    expect(placement.outdated).toEqual([]);
  });

  it("puts a LEFT thread on the deletions side of its line", () => {
    const placement = placeThreads([file], [thread({ side: "LEFT", line: 11 })]);

    expect(placement.placed).toEqual([
      expect.objectContaining({ side: "deletions", lineNumber: 11 }),
    ]);
  });

  it("places a thread on a context line from either side", () => {
    const placement = placeThreads(
      [file],
      [
        thread({ id: "right", side: "RIGHT", line: 13 }),
        thread({ id: "left", side: "LEFT", line: 12 }),
      ],
    );

    expect(placement.placed.map(({ thread: { id } }) => id)).toEqual(["right", "left"]);
  });

  it("moves a thread that GitHub marks outdated to outdated", () => {
    const placement = placeThreads([file], [thread({ outdated: true, line: 11 })]);

    expect(placement.placed).toEqual([]);
    expect(placement.outdated.map(({ id }) => id)).toEqual(["t1"]);
  });

  it("moves a thread without a line to outdated", () => {
    expect(placeThreads([file], [thread({ line: null })]).outdated).toHaveLength(1);
  });

  it("moves a thread whose line is outside the hunks to outdated", () => {
    const placement = placeThreads(
      [file],
      [
        thread({ id: "after", side: "RIGHT", line: 14 }),
        thread({ id: "before", side: "LEFT", line: 9 }),
      ],
    );

    expect(placement.outdated.map(({ id }) => id)).toEqual(["after", "before"]);
  });

  it("does not place a RIGHT thread on a line that only the old side has", () => {
    const deletionsOnly: ReviewFile = { ...file, patch: "@@ -20,2 +20,0 @@\n-a\n-b" };

    expect(
      placeThreads([deletionsOnly], [thread({ side: "RIGHT", line: 21 })]).outdated,
    ).toHaveLength(1);
  });

  it("moves a thread on a file that is not in the PR to outdated", () => {
    expect(placeThreads([file], [thread({ path: "src/gone.ts" })]).outdated).toHaveLength(1);
  });

  it("moves a thread on a file without a patch to outdated", () => {
    expect(placeThreads([{ ...file, patch: null }], [thread({})]).outdated).toHaveLength(1);
  });

  it("places the recorded threads as GitHub does", () => {
    const placement = placeThreads(
      parsePrFiles(recordedFiles),
      parseReviewThreads([recordedThreads]),
    );

    expect(
      placement.placed.map(({ thread: { id }, side, lineNumber }) => [id, side, lineNumber]),
    ).toEqual([
      ["PRRT_kwDOHI7l-86jxqt3", "additions", 151],
      ["PRRT_kwDOHI7l-86jxula", "additions", 46],
    ]);
    expect(placement.outdated.map(({ id }) => id)).toEqual([
      "PRRT_kwDOHI7l-86jvKxS",
      "PRRT_kwDOHI7l-86jx0SN",
    ]);
  });
});

describe("openThreadCounts", () => {
  it("counts unresolved threads, and the unresolved outdated ones apart", () => {
    const counts = openThreadCounts({
      placed: [
        { thread: thread({ id: "open" }), side: "additions", lineNumber: 11 },
        { thread: thread({ id: "resolved", resolved: true }), side: "additions", lineNumber: 11 },
      ],
      outdated: [
        thread({ id: "outdated", outdated: true }),
        thread({ id: "gone", resolved: true }),
      ],
    });

    expect(counts).toEqual({ open: 2, outdated: 1 });
  });
});

describe("visibleThreads", () => {
  const placement = placeThreads(
    parsePrFiles(recordedFiles),
    parseReviewThreads([recordedThreads]),
  );
  const resolved = "PRRT_kwDOHI7l-86jvKxS";
  const ids = (threads: ReturnType<typeof visibleThreads>) => [
    ...threads.placed.map(({ thread }) => thread.id),
    ...threads.outdated.map(({ id }) => id),
  ];

  it("hides a resolved thread when show resolved is off", () => {
    expect(ids(visibleThreads(placement, false, new Set()))).not.toContain(resolved);
  });

  it("shows a revealed resolved thread when show resolved is off", () => {
    expect(ids(visibleThreads(placement, false, new Set([resolved])))).toContain(resolved);
  });
});

describe("commentHolders", () => {
  const placement = placeThreads(
    parsePrFiles(recordedFiles),
    parseReviewThreads([recordedThreads]),
  );

  it("names the threads and files that hold the comments", () => {
    const holders = commentHolders(
      placement,
      new Set(["PRRC_kwDOHI7l-87xSFQS", "PRRC_kwDOHI7l-87xNizU"]),
    );

    expect(holders.threadIds).toEqual(new Set(["PRRT_kwDOHI7l-86jxula", "PRRT_kwDOHI7l-86jvKxS"]));
    expect(holders.paths).toEqual(
      new Set([
        "apps/shell/e2e/catalog/integrations/components/asset/generic-configuration/createDatabricksOutboundSyncConfigurationComponent.ts",
      ]),
    );
  });
});
