// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import type {
  PluginCommandContext,
  PluginTargetedPanelActionOpenOptions,
} from "@get-bb/plugin-sdk/app";
import { useCommandIntent, type CommandTab } from "./command-intents";
import { GITHUB_COMMANDS } from "./commands";
import { rememberInsight, forgetInsights } from "./pr-availability";
import type { InsightResult } from "../contract";
import type { MergeAction } from "../core/merge-action";

afterEach(() => {
  cleanup();
  forgetInsights();
});

function command(id: string) {
  const found = GITHUB_COMMANDS.find((entry) => entry.id === id);
  if (!found) throw new Error(`no command ${id}`);
  return found;
}

function context(threadId: string | null, accepted = true) {
  const opened: PluginTargetedPanelActionOpenOptions[] = [];
  const ctx: PluginCommandContext = {
    threadId,
    projectId: null,
    openPanel: (options) => {
      opened.push(options);
      return accepted;
    },
  };
  return { ctx, opened };
}

function listen(threadId: string, tab: CommandTab) {
  const received: string[] = [];
  renderHook(() => useCommandIntent(threadId, tab, (intent) => received.push(intent)));
  return received;
}

describe("GitHub palette commands", () => {
  it("registers the eight commands without default keys", () => {
    expect(GITHUB_COMMANDS.map(({ title }) => title)).toEqual([
      "GitHub: Merge PR",
      "GitHub: Open PR tab",
      "GitHub: Open PR files",
      "GitHub: Submit review",
      "GitHub: Next comment",
      "GitHub: Previous comment",
      "GitHub: Refresh PR",
      "GitHub: Open PR on GitHub",
    ]);
    expect(GITHUB_COMMANDS.every((entry) => entry.defaultShortcut === undefined)).toBe(true);
  });

  it("has no command that sends to the agent", () => {
    expect(GITHUB_COMMANDS.some(({ id, title }) => /agent/i.test(id + title))).toBe(false);
  });

  function ok(mergeAction: MergeAction): InsightResult {
    return {
      kind: "ok",
      insight: {
        pr: {
          number: 1,
          title: "t",
          state: "open",
          url: "https://github.com/o/r/pull/1",
          headOid: "abc",
          headRefName: "feature",
          headOwner: null,
          isCrossRepository: false,
          baseRefName: "main",
          author: "koenvg",
          additions: 1,
          deletions: 0,
          changedFiles: 1,
        },
        mergeAction,
        blockers: [],
        reviewers: [],
        checks: [],
        mergeQueue: null,
        autoMergeAction: { kind: "none" },
        canUpdateBranch: false,
      },
      refreshedAt: 0,
      error: null,
    };
  }

  function listed(threadId: string | null) {
    return GITHUB_COMMANDS.filter(
      (entry) => entry.isAvailable?.(context(threadId).ctx) ?? true,
    ).map(({ id }) => id);
  }

  const ALL_BUT_MERGE = [
    "open-pr-tab",
    "open-pr-files",
    "submit-review",
    "next-comment",
    "previous-comment",
    "refresh-pr",
    "open-pr-on-github",
  ];

  it("lists no command without a thread", () => {
    expect(listed(null)).toEqual([]);
  });

  it("lists no command before the first PR load of the thread", () => {
    expect(listed("thr_not_loaded")).toEqual([]);
  });

  it("lists no command for a thread without a PR", () => {
    rememberInsight("thr_no_pr", { kind: "no_pr" });

    expect(listed("thr_no_pr")).toEqual([]);
  });

  it("lists every command but Merge PR for a PR that cannot merge", () => {
    rememberInsight("thr_blocked", ok({ kind: "none" }));

    expect(listed("thr_blocked")).toEqual(ALL_BUT_MERGE);
  });

  it("lists all eight commands for a PR that can merge", () => {
    rememberInsight("thr_ready", ok({ kind: "enqueue" }));

    expect(listed("thr_ready")).toEqual(["merge-pr", ...ALL_BUT_MERGE]);
  });

  it("posts merge to chat without opening a panel, even if the host would decline", () => {
    const received = listen("thr_chat_merge", "merge");
    const tabReceived = listen("thr_chat_merge", "pr");
    const { ctx, opened } = context("thr_chat_merge", false);
    void command("merge-pr").run(ctx);
    expect(opened).toEqual([]);
    expect(received).toEqual(["merge"]);
    expect(tabReceived).toEqual([]);
  });

  it.each([
    ["open-pr-tab", "show-overview", null],
    ["open-pr-files", "show-files", null],
    ["submit-review", "show-files", ["files", "submit"]],
    ["next-comment", "show-files", ["files", "next-comment"]],
    ["previous-comment", "show-files", ["files", "previous-comment"]],
    ["refresh-pr", "show-overview", ["overview", "refresh"]],
    ["open-pr-on-github", null, ["overview", "open-on-github"]],
  ] as const)(
    "%s opens the PR tab once, without params, on sub-tab %s, then posts %s",
    (id, subTab, followUp) => {
      const threadId = `thr_${id}`;
      const subTabs = listen(threadId, "pr");
      const followUps = {
        overview: listen(threadId, "overview"),
        files: listen(threadId, "files"),
      };
      const { ctx, opened } = context(threadId);

      void command(id).run(ctx);

      expect(opened).toEqual([{ actionId: "pr" }]);
      expect(subTabs).toEqual(subTab === null ? [] : [subTab]);
      expect(followUps).toEqual({
        overview: followUp?.[0] === "overview" ? [followUp[1]] : [],
        files: followUp?.[0] === "files" ? [followUp[1]] : [],
      });
    },
  );

  it("posts the sub-tab before the Files action", () => {
    const order: string[] = [];
    renderHook(() => useCommandIntent("thr_order", "pr", (intent) => order.push(intent)));
    renderHook(() => useCommandIntent("thr_order", "files", (intent) => order.push(intent)));

    void command("next-comment").run(context("thr_order").ctx);

    expect(order).toEqual(["show-files", "next-comment"]);
  });

  it("leaves no intent behind when the host declines to open the tab", () => {
    const { ctx } = context("thr_declined", false);

    void command("refresh-pr").run(ctx);

    expect(listen("thr_declined", "pr")).toEqual([]);
    expect(listen("thr_declined", "overview")).toEqual([]);
  });
});
