// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parsePatchFiles } from "@pierre/diffs";
import type { Snapshot } from "../core/text-context";
import { textRevisions } from "../core/text-context";
import { contextEligibility, prepareContextControls, useFileContext } from "./use-file-context";

const transport = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@get-bb/plugin-sdk/app", () => ({ useRpc: () => transport }));
const snapshot: Snapshot = {
  threadId: "thread",
  generation: 1,
  basis: {
    environmentId: "env",
    headSha: "a".repeat(40),
    mergeBaseRef: "b".repeat(40),
    target: { kind: "all" },
  },
  file: {
    path: "a.txt",
    previousPath: null,
    status: "modified",
    additions: 1,
    deletions: 1,
    binary: false,
    loadMode: "auto",
  },
  patch: "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -2 +2 @@\n-old\n+new\n",
};
function response(source = snapshot) {
  const revisions = textRevisions(source.basis, source.file);
  return {
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
  };
}
function deferred() {
  let resolve!: (result: unknown) => void;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function Harness({ source }: { source: Snapshot | null }) {
  const context = useFileContext(source);
  return (
    <>
      <button
        onClick={() => {
          context.activate();
          context.activate();
        }}
      >
        Load context
      </button>
      <output>
        {context.state.kind === "ready"
          ? context.state.diff.additionLines.join("")
          : context.state.kind === "failed"
            ? context.state.error.message
            : context.state.kind}
      </output>
    </>
  );
}
afterEach(cleanup);
beforeEach(() => transport.call.mockReset());

describe("per-file lazy context", () => {
  it("loads lazily once, suppresses repeated clicks and preserves full contents", async () => {
    const pending = deferred();
    transport.call.mockReturnValue(pending.promise);
    const screen = render(<Harness source={snapshot} />);
    expect(screen.getByRole("status").textContent).toBe("idle");
    expect(transport.call.mock.calls).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Load context" }));
    expect(screen.getByRole("status").textContent).toBe("loading");
    expect(transport.call.mock.calls).toEqual([
      [
        "getTextContext",
        {
          threadId: "thread",
          basis: snapshot.basis,
          file: snapshot.file,
          patch: snapshot.patch,
        },
      ],
    ]);
    await act(async () => pending.resolve(response()));
    expect(screen.getByRole("status").textContent).toBe("prefix\nnew\nsuffix\n");
    fireEvent.click(screen.getByRole("button"));
    expect(transport.call.mock.calls).toHaveLength(1);
  });
  it("retains a retryable read failure and successfully retries", async () => {
    transport.call.mockRejectedValueOnce(Error("offline")).mockResolvedValueOnce(response());
    const screen = render(<Harness source={snapshot} />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("Could not load context. Retry."),
    );
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("prefix\nnew\nsuffix\n"),
    );
  });
  it("refuses drift and asks for refresh rather than retrying mismatched data", async () => {
    transport.call.mockResolvedValue({
      ...response(),
      new: { ...response().new, contents: "DRIFT!\nnew\nsuffix\n" },
    });
    const screen = render(<Harness source={snapshot} />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        "Context does not match this diff. Refresh changes.",
      ),
    );
    fireEvent.click(screen.getByRole("button"));
    expect(transport.call.mock.calls).toHaveLength(1);
  });
  it.each([
    ["generation", { ...snapshot, generation: 2 }],
    ["patch", { ...snapshot, patch: snapshot.patch.replace("+new", "+NEW") }],
    ["thread", { ...snapshot, threadId: "other" }],
    ["environment", { ...snapshot, basis: { ...snapshot.basis, environmentId: "other" } }],
    [
      "target",
      { ...snapshot, basis: { ...snapshot.basis, target: { kind: "uncommitted" as const } } },
    ],
    ["revision", { ...snapshot, basis: { ...snapshot.basis, headSha: "c".repeat(40) } }],
    ["path", { ...snapshot, file: { ...snapshot.file, path: "other.txt" } }],
    ["previous path", { ...snapshot, file: { ...snapshot.file, previousPath: "previous.txt" } }],
    ["inactivity", null],
  ])("ignores late replies after %s changes and identity reuse", async (_name, changed) => {
    const pending = deferred();
    transport.call.mockReturnValueOnce(pending.promise).mockResolvedValue(response());
    const screen = render(<Harness source={snapshot} />);
    fireEvent.click(screen.getByRole("button"));
    screen.rerender(<Harness source={changed} />);
    expect(screen.getByRole("status").textContent).toBe("idle");
    screen.rerender(<Harness source={snapshot} />);
    await act(async () => pending.resolve(response()));
    expect(screen.getByRole("status").textContent).toBe("idle");
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("prefix\nnew\nsuffix\n"),
    );
  });
  it("discards replies after unmount", async () => {
    const pending = deferred();
    transport.call.mockReturnValueOnce(pending.promise).mockResolvedValue(response());
    const first = render(<Harness source={snapshot} />);
    fireEvent.click(first.getByRole("button"));
    first.unmount();
    await act(async () => pending.resolve(response()));
    const second = render(<Harness source={snapshot} />);
    expect(second.getByRole("status").textContent).toBe("idle");
    fireEvent.click(second.getByRole("button"));
    await waitFor(() =>
      expect(second.getByRole("status").textContent).toBe("prefix\nnew\nsuffix\n"),
    );
  });
  it("offers only supported partial text, with an explicit quoted-path limit", () => {
    const partial = parsePatchFiles(snapshot.patch)[0]!.files[0]!;
    expect(contextEligibility(snapshot, partial)).toBe(null);
    expect(
      contextEligibility({ ...snapshot, file: { ...snapshot.file, path: "my file.txt" } }, partial),
    ).toBe("Context is unavailable for quoted file paths.");
    expect(
      contextEligibility({ ...snapshot, file: { ...snapshot.file, binary: true } }, partial),
    ).toBe("Context is unavailable for this file.");
    expect(contextEligibility(null, partial)).toBe("");
    expect(contextEligibility(snapshot, { ...partial, isPartial: false })).toBe("");
  });
  it("labels native controls and activates the existing click action with Enter and Space", () => {
    const node = document.createElement("div");
    document.body.append(node);
    const root = node.attachShadow({ mode: "open" });
    root.innerHTML =
      '<div role="button" data-expand-button data-expand-down></div><div role="button" data-expand-button data-expand-up></div><output></output>';
    const above = root.querySelector<HTMLElement>("[data-expand-down]")!;
    const below = root.querySelector<HTMLElement>("[data-expand-up]")!;
    above.onclick = () => {
      root.querySelector("output")!.textContent = "prefix revealed";
    };
    below.onclick = () => {
      root.querySelector("output")!.textContent = "suffix revealed";
    };
    prepareContextControls(node);
    expect([
      above.tabIndex,
      above.getAttribute("aria-label"),
      below.getAttribute("aria-label"),
    ]).toEqual([0, "Expand unchanged lines above", "Expand unchanged lines below"]);
    above.focus();
    fireEvent.keyDown(above, { key: "Enter" });
    expect(root.querySelector("output")!.textContent).toBe("prefix revealed");
    below.focus();
    fireEvent.keyDown(below, { key: " " });
    expect(root.querySelector("output")!.textContent).toBe("suffix revealed");
    node.remove();
  });
});
