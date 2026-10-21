// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { installTestPluginRuntime, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { ComponentProps } from "react";
import type { ActionResult, rpcContract } from "../contract";
import type { RunnableMergeAction } from "../core/merge-action";
import { forgetInsights } from "./pr-availability";

installTestPluginRuntime();
const { MergeActionButton } = await import("./merge-action-button");

afterEach(() => {
  cleanup();
  forgetInsights();
});

const pr = {
  number: 7,
  title: "Add palette commands",
  state: "open",
  url: "https://github.com/o/r/pull/7",
  headOid: "abc123",
  headRefName: "feature",
  headOwner: null,
  isCrossRepository: false,
  baseRefName: "main",
  author: "koenvg",
  additions: 1,
  deletions: 0,
  changedFiles: 1,
} as const;

type Props = ComponentProps<typeof MergeActionButton>;

function renderButton(
  action: RunnableMergeAction,
  props: Partial<Props> = {},
  runPrAction: () => ActionResult | Promise<ActionResult> = () => ({ kind: "ok" }),
) {
  return renderSlot<Props, typeof rpcContract>(
    { component: MergeActionButton },
    { threadId: "thr_1", pr, action, ...props },
    { rpc: { runPrAction } as never },
  );
}

function mergeCalls(slot: ReturnType<typeof renderButton>) {
  return slot.inspection.rpcCalls.filter((call) => call.method === "runPrAction");
}

describe("MergeActionButton", () => {
  it("opens confirmation on a click without sending a write", async () => {
    const slot = renderButton({ kind: "merge", method: "SQUASH" });
    fireEvent.click(await slot.findByRole("button", { name: "Squash and merge" }));
    const dialog = await slot.findByRole("alertdialog");
    expect(within(dialog).getByText("Merge pull request #7?")).toBeTruthy();
    expect(mergeCalls(slot)).toEqual([]);
  });

  it("sends one enqueue on a click without a dialog", async () => {
    const slot = renderButton({ kind: "enqueue" });
    fireEvent.click(await slot.findByRole("button", { name: "Enqueue" }));
    await act(async () => {});
    expect(slot.queryByRole("alertdialog")).toBeNull();
    expect(mergeCalls(slot)).toEqual([
      expect.objectContaining({
        input: { threadId: "thr_1", action: "enqueue", expectedHeadOid: pr.headOid },
      }),
    ]);
  });

  it("does nothing without a click", async () => {
    const slot = renderButton({ kind: "enqueue" });
    await slot.findByRole("button", { name: "Enqueue" });
    expect(mergeCalls(slot)).toEqual([]);
  });
});
