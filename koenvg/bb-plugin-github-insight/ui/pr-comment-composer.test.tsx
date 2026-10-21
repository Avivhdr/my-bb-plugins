// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { ActionResult, rpcContract } from "../contract";
import { PrCommentComposer } from "./pr-comment-composer";

afterEach(cleanup);

function renderComposer(addPrComment: () => ActionResult | Promise<ActionResult>) {
  const onPosted = vi.fn(async () => {});
  const slot = renderSlot<
    { threadId: string; prNodeId: string; onPosted: () => Promise<void> },
    typeof rpcContract
  >(
    { component: PrCommentComposer },
    { threadId: "thr_1", prNodeId: "PR_1", onPosted },
    { rpc: { addPrComment } as never },
  );
  const box = slot.getByRole("textbox", { name: "Comment" }) as HTMLTextAreaElement;
  const button = slot.getByRole("button", { name: "Comment" }) as HTMLButtonElement;
  return { slot, box, button, onPosted };
}

function posts(slot: ReturnType<typeof renderSlot>) {
  return slot.inspection.rpcCalls.filter((call) => call.method === "addPrComment");
}

describe("PR comment composer", () => {
  it("disables Comment while the box is empty", () => {
    const { box, button } = renderComposer(() => ({ kind: "ok" }));

    expect(button.disabled).toBe(true);
    fireEvent.change(box, { target: { value: "   " } });
    expect(button.disabled).toBe(true);
    fireEvent.change(box, { target: { value: "Thanks, fixed" } });
    expect(button.disabled).toBe(false);
  });

  it("posts the text, clears the box, and reloads the timeline", async () => {
    const { slot, box, button, onPosted } = renderComposer(() => ({ kind: "ok" }));
    fireEvent.change(box, { target: { value: "Thanks, fixed" } });

    await act(async () => fireEvent.click(button));

    expect(posts(slot).map((call) => call.input)).toEqual([
      { threadId: "thr_1", prNodeId: "PR_1", body: "Thanks, fixed" },
    ]);
    expect(box.value).toBe("");
    expect(onPosted).toHaveBeenCalledOnce();
  });

  it("keeps the text and shows the error when GitHub rejects the comment", async () => {
    const { slot, box, button, onPosted } = renderComposer(() => ({
      kind: "error",
      message: "Resource not accessible by integration",
    }));
    fireEvent.change(box, { target: { value: "Thanks, fixed" } });

    await act(async () => fireEvent.click(button));

    expect(box.value).toBe("Thanks, fixed");
    expect(slot.getByRole("alert").textContent).toContain("Resource not accessible by integration");
    expect(onPosted).not.toHaveBeenCalled();
  });

  it("sends one comment for a double click", async () => {
    let finish!: (result: ActionResult) => void;
    const { slot, box, button } = renderComposer(
      () => new Promise((resolve) => (finish = resolve)),
    );
    fireEvent.change(box, { target: { value: "Thanks, fixed" } });

    fireEvent.click(button);
    fireEvent.click(button);

    expect(button.disabled).toBe(true);
    await act(async () => finish({ kind: "ok" }));
    expect(posts(slot)).toHaveLength(1);
  });
});
