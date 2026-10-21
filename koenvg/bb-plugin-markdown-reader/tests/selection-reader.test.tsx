import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import pluginApp from "../app";
import pluginServer from "../server";
import { readResultSchema, type ReaderTarget } from "../source";
import {
  useComposer,
  type PluginComposerApi,
  type PluginFileOpenerProps,
} from "@get-bb/plugin-sdk/app";

const disposers: (() => Promise<void>)[] = [];
afterEach(async () => {
  window.getSelection()?.removeAllRanges();
  cleanup();
  for (const dispose of disposers.splice(0)) await dispose();
});
const target: ReaderTarget = {
  path: "note.md",
  source: { kind: "workspace", threadId: "owner", environmentId: null, projectId: null },
};
async function mount(
  selectedTarget = target,
  content = "# Heading\n\nSelected prose.\n",
  draft = "Keep @owner",
) {
  const { bb, harness } = createFakePluginHost({
    pluginId: "markdown-reader",
    experimental_callHostRpc: async ({ input }) => input,
    sdk: {
      threads: {
        get: async () => ({ id: "owner", projectId: "project", environmentId: "env" }),
        storageLocation: async () => ({ hostId: "remote", storageRootPath: "/storage" }),
      },
      environments: {
        get: async () => ({
          id: "env",
          projectId: "project",
          hostId: "remote",
          path: "/work",
          status: "ready",
        }),
      },
      files: {
        read: async () => ({
          content,
          contentEncoding: "utf8",
          sizeBytes: new TextEncoder().encode(content).length,
          sha256: "hash",
        }),
      },
    },
  });
  pluginServer(bb);
  disposers.push(() => harness.lifecycle.dispose());
  const app = await loadPluginApp(pluginApp);
  let api: PluginComposerApi;
  const Opener = app.fileOpeners[0]!.component;
  function ObservedOpener(props: PluginFileOpenerProps) {
    api = useComposer();
    return <Opener {...props} />;
  }
  const slot = renderSlot(
    { component: ObservedOpener },
    { ...selectedTarget, Original: () => <p>Original</p> },
    {
      composer: {
        scope: { kind: "thread", threadId: "destination" },
        text: draft,
        mentions: draft
          ? [{ kind: "thread", threadId: "owner", label: "@owner", from: 5, to: 11 }]
          : [],
        attachmentCount: 1,
        attachments: [
          { type: "localFile", name: "keep.txt", path: "/uploads/keep.txt", sizeBytes: 4 },
        ],
      },
      rpc: {
        read_document: async (input) =>
          readResultSchema.parse(await harness.behavior.callRpc("read_document", input)),
      },
    },
  );
  await slot.findByRole("heading", { name: "Heading" });
  return { slot, harness, api: api! };
}
function select(node: Node, start = 0, end = node.textContent!.length) {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  fireEvent(document, new Event("selectionchange"));
  fireEvent.pointerUp(node.parentElement!);
}
it("appends selected Preview prose to the associated draft without replacing, sending, or file access", async () => {
  const { slot, harness } = await mount();
  const original = slot.inspection.composer.draft;
  const calls = [...harness.inspection.sdk.calls];
  select(slot.getByText("Selected prose.").firstChild!, 0, 8);
  fireEvent.click(await slot.findByRole("button", { name: "Add to chat" }));
  await waitFor(() =>
    expect(slot.inspection.composer.text).toBe(
      "Keep @owner\n\n> note.md\n> workspace · host remote\n> Selected\n",
    ),
  );
  expect(slot.inspection.composer.draft.mentions).toEqual(original.mentions);
  expect(slot.inspection.composer.attachmentCount).toBe(1);
  expect(slot.inspection.composer.draft.attachments).toEqual(original.attachments);
  expect(slot.inspection.composer.focusCount).toBe(1);
  expect(slot.inspection.composer.submits).toEqual([]);
  expect(harness.inspection.sdk.calls).toEqual(calls);
  expect(slot.inspection.rpcCalls.map((call) => call.method)).toEqual(["read_document"]);
});

it.each([
  ["workspace", "note.md", "> note.md:3-4\n> workspace · host remote\n"],
  ["host", "/notes/note.md", "> /notes/note.md:3-4\n> host · host remote\n"],
  [
    "thread-storage",
    "note.md",
    "> note.md:3-4\n> thread-storage · host remote · owner thread owner\n",
  ],
] as const)(
  "quotes exact Raw text for %s and excludes a next-line start boundary",
  async (kind, path, reference) => {
    const { slot, harness } = await mount(
      { path, source: { ...target.source, kind, experimental_hostId: "remote" } },
      "# Heading\n\n  alpha **one**\n\n  beta `two`\n",
      "",
    );
    fireEvent.click(slot.getByRole("button", { name: "Raw" }));
    const spans = slot.getByLabelText("Raw Markdown").querySelectorAll("[data-source-line]");
    const range = document.createRange();
    range.setStart(spans[2]!.firstChild!, 2);
    range.setEnd(spans[4]!.firstChild!, 0);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    fireEvent(document, new Event("selectionchange"));
    fireEvent.click(await slot.findByRole("button", { name: "Add to chat" }));
    expect(slot.inspection.composer.text).toBe(reference + "> alpha **one**\n> \n> \n");
    expect(slot.inspection.composer.submits).toEqual([]);
    expect(harness.inspection.sdk.callsTo("files.read")).toHaveLength(1);
  },
);
it.each([
  {
    label: "inside a multi-line group with BOM, Unicode, CRLF and lone CR",
    content: "\uFEFF# Heading\r\n" + "\n".repeat(300) + "  é😀 one\r\n\r  beta\nlast",
    from: "é😀 one",
    to: "  beta",
    expected: "> note.md:302-303\n> workspace · host remote\n> é😀 one\n> \n> \n",
  },
  {
    label: "across group boundaries with a next-line start endpoint",
    content: "# Heading\r\n" + Array.from({ length: 1000 }, (_, i) => `line ${i + 1}\r\n`).join(""),
    from: "line 7\r\n",
    to: "line 10\r\n",
    expected: "> note.md:8-10\n> workspace · host remote\n> line 7\n> line 8\n> line 9\n> \n",
  },
])("cites source lines $label", async ({ content, from, to, expected }) => {
  const { slot } = await mount(target, content, "");
  fireEvent.click(slot.getByRole("button", { name: "Raw" }));
  const raw = slot.getByLabelText("Raw Markdown");
  const boundary = (offset: number): [Node, number] => {
    const walker = document.createTreeWalker(raw, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      if (offset <= node.textContent!.length) return [node, offset];
      offset -= node.textContent!.length;
      node = walker.nextNode();
    }
    throw new Error("Selection offset outside source");
  };
  const range = document.createRange();
  range.setStart(...boundary(content.indexOf(from)));
  range.setEnd(...boundary(content.indexOf(to)));
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  fireEvent(document, new Event("selectionchange"));
  fireEvent.click(await slot.findByRole("button", { name: "Add to chat" }));
  expect(slot.inspection.composer.text).toBe(expected);
  expect(slot.inspection.composer.submits).toEqual([]);
  expect(slot.inspection.composer.focusCount).toBe(1);
});

it("cites an element-boundary selection in grouped Raw", async () => {
  const { slot } = await mount(target, "# Heading\r\n" + "\n".repeat(300), "");
  fireEvent.click(slot.getByRole("button", { name: "Raw" }));
  const raw = slot.getByLabelText("Raw Markdown");
  const range = document.createRange();
  range.setStart(raw, 0);
  range.setEnd(raw, 1);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  fireEvent(document, new Event("selectionchange"));
  fireEvent.click(await slot.findByRole("button", { name: "Add to chat" }));
  expect(slot.inspection.composer.text).toBe(
    "> note.md:1-3\n> workspace · host remote\n> # Heading\n> \n> \n> \n",
  );
});

it("keeps storage ownership separate from the recipient and preserves a selected draft range", async () => {
  const { slot, api } = await mount({
    ...target,
    source: { ...target.source, kind: "thread-storage" },
  });
  const insert = vi.spyOn(api, "insert");
  const replace = vi.spyOn(api, "replace");
  select(slot.getByText("Selected prose.").firstChild!, 0, 8);
  fireEvent.click(await slot.findByRole("button", { name: "Add to chat" }));
  // The public harness has no caret. Explicit placement is the SDK contract
  // that protects a selected range; actual editor selection is a native check.
  expect(insert).toHaveBeenCalledWith(expect.any(String), { at: "end", block: true });
  expect(replace).not.toHaveBeenCalled();
  expect(slot.inspection.composer.scope).toEqual({ kind: "thread", threadId: "destination" });
  expect(slot.inspection.composer.text).toBe(
    "Keep @owner\n\n> note.md\n> thread-storage · host remote · owner thread owner\n> Selected\n",
  );
});
it("discards a pending quote when the associated composer changes", async () => {
  const { slot } = await mount();
  select(slot.getByText("Selected prose.").firstChild!);
  const button = await slot.findByRole("button", { name: "Add to chat" });
  await slot.behavior.setComposerScope({ kind: "thread", threadId: "other" });
  fireEvent.click(button);
  expect(slot.queryByRole("button", { name: "Add to chat" })).toBeNull();
  expect(slot.inspection.composer.text).toBe("Keep @owner");
  expect(slot.inspection.composer.submits).toEqual([]);
});
it("shows an unavailable action for a queued-message editor without changing its draft", async () => {
  const { slot } = await mount();
  await slot.behavior.setComposerScope({
    kind: "queued-message",
    threadId: "destination",
    queuedMessageId: "queue",
  });
  select(slot.getByText("Selected prose.").firstChild!);
  const button = await slot.findByRole("button", { name: "Add to chat" });
  expect(button.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(button);
  expect(slot.inspection.composer.text).toBe("Keep @owner");
  expect(slot.inspection.composer.focusCount).toBe(0);
  expect(slot.getByRole("status").textContent).toBe("No associated chat draft is available.");
});
it("reports rejected insertion once, with no retry or draft loss", async () => {
  const { slot, api } = await mount();
  const insert = vi.spyOn(api, "insert").mockImplementation(() => {
    throw new Error("Unavailable");
  });
  select(slot.getByText("Selected prose.").firstChild!);
  const button = await slot.findByRole("button", { name: "Add to chat" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(insert).toHaveBeenCalledTimes(1);
  expect(slot.getByRole("alert").textContent).toContain("Could not add");
  expect(slot.inspection.composer.text).toBe("Keep @owner");
  expect(slot.inspection.composer.focusCount).toBe(0);
});
it("does not repeat a successful insertion when focus fails", async () => {
  const { slot, api } = await mount();
  const insert = vi.spyOn(api, "insert");
  vi.spyOn(api, "focus").mockImplementation(() => {
    throw new Error("Not mounted");
  });
  select(slot.getByText("Selected prose.").firstChild!, 0, 8);
  const button = await slot.findByRole("button", { name: "Add to chat" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(insert).toHaveBeenCalledTimes(1);
  expect(slot.getByRole("alert").textContent).toContain("Selection added to the draft");
  expect(slot.inspection.composer.text).toBe(
    "Keep @owner\n\n> note.md\n> workspace · host remote\n> Selected\n",
  );
  expect(slot.inspection.composer.submits).toEqual([]);
});

it.each([
  ["host", "/notes/note.md", "> /notes/note.md\n> host · host remote\n"],
  ["thread-storage", "note.md", "> note.md\n> thread-storage · host remote · owner thread owner\n"],
  [
    "workspace",
    "note.md",
    "> note.md\n> workspace · host remote · project project · environment env\n",
  ],
] as const)(
  "uses captured %s provenance for Preview with no inferred source lines",
  async (kind, path, reference) => {
    const { slot } = await mount(
      {
        path,
        source: {
          kind,
          threadId: "owner",
          projectId: "project",
          environmentId: "env",
          experimental_hostId: "remote",
        },
      },
      "# Heading\n\nSelected prose.\n",
      "",
    );
    select(slot.getByText("Selected prose.").firstChild!, 0, 8);
    fireEvent.click(await slot.findByRole("button", { name: "Add to chat" }));
    expect(slot.inspection.composer.text).toBe(reference + "> Selected\n");
  },
);
