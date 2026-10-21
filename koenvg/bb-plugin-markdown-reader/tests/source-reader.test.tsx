import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import pluginApp from "../app";
import pluginServer from "../server";
import { readResultSchema, type ReaderTarget } from "../source";
import type { LineRequest } from "@bb-plugins/markdown-document";

const targets: ReaderTarget[] = [
  {
    path: "note.md",
    source: { kind: "workspace", threadId: "thread", environmentId: null, projectId: null },
  },
  {
    path: "/notes/note.md",
    source: {
      kind: "host",
      threadId: null,
      environmentId: null,
      projectId: null,
      experimental_hostId: "remote",
    },
  },
  {
    path: "note.md",
    source: { kind: "thread-storage", threadId: "thread", environmentId: null, projectId: null },
  },
];
const disposers: (() => Promise<void>)[] = [];
afterEach(async () => {
  cleanup();
  for (const dispose of disposers.splice(0)) await dispose();
});
async function mount(
  target: ReaderTarget,
  read: () => Promise<{
    content: string;
    contentEncoding: "utf8" | "base64";
    sizeBytes: number;
    sha256: string;
  }>,
  lineRange?: LineRequest,
) {
  const { bb, harness } = createFakePluginHost({
    pluginId: "markdown-reader",
    experimental_callHostRpc: async ({ input }) => input,
    sdk: {
      threads: {
        get: async () => ({ id: "thread", projectId: "project", environmentId: "env" }),
        storageLocation: async () => ({
          hostId: "remote",
          storageRootPath: "/host-data/actual-storage-root",
        }),
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
      files: { read },
    },
  });
  disposers.push(() => harness.lifecycle.dispose());
  pluginServer(bb);
  const app = await loadPluginApp(pluginApp);
  const slot = renderSlot(
    app.fileOpeners[0]!,
    {
      ...target,
      experimental_lineRange: lineRange,
      Original: () => <p>Original for {target.source.kind}</p>,
    },
    {
      rpc: {
        read_document: async (input) =>
          readResultSchema.parse(await harness.behavior.callRpc("read_document", input)),
      },
    },
  );
  return { slot, harness, Opener: app.fileOpeners[0]!.component };
}
function file(
  content: string,
  contentEncoding: "utf8" | "base64" = "utf8",
  sizeBytes = new TextEncoder().encode(content).length,
) {
  return { content, contentEncoding, sizeBytes, sha256: "hash" };
}

describe("source to rendered reader integration", () => {
  it.each(targets)(
    "loads and refreshes $source.kind Preview/Raw through the validated read-only RPC",
    async (target) => {
      let text = "# First\r\n\r\nActual é text  \r\n";
      const { slot, harness } = await mount(target, async () => file(text));
      await slot.findByRole("heading", { name: "First" });
      fireEvent.click(slot.getByRole("button", { name: "Raw" }));
      expect(slot.getByLabelText("Raw Markdown").textContent).toBe(text);
      text = '# Refreshed\n\n```json\n{"actual":true}  \n```\n';
      // Source changes alone do not update the loaded snapshot. There is no watch/poll.
      expect(slot.getByLabelText("Raw Markdown").textContent).not.toBe(text);
      expect(harness.inspection.sdk.callsTo("files.read")).toHaveLength(1);
      fireEvent.click(slot.getByRole("button", { name: "Refresh" }));
      await waitFor(() => expect(slot.getByLabelText("Raw Markdown").textContent).toBe(text));
      fireEvent.click(slot.getByRole("button", { name: "Preview" }));
      await slot.findByRole("heading", { name: "Refreshed" });
      const reads = harness.inspection.sdk.callsTo("files.read");
      expect(reads).toHaveLength(2);
      for (const [input] of reads)
        expect(input).toMatchObject({
          hostId: "remote",
          rootPath:
            target.source.kind === "workspace"
              ? "/work"
              : target.source.kind === "host"
                ? "/notes"
                : "/host-data/actual-storage-root",
        });
      expect(
        harness.inspection.sdk.calls.every((call) =>
          ["threads.get", "threads.storageLocation", "environments.get", "files.read"].includes(
            call.path,
          ),
        ),
      ).toBe(true);
    },
  );
  it.each(targets)(
    "recovers $source.kind from missing, inaccessible, and disconnected reads with Retry",
    async (target) => {
      for (const message of ["File missing", "Access denied", "Host disconnected"]) {
        let fail = true;
        const { slot, harness } = await mount(target, async () => {
          if (fail) throw new Error(message);
          return file("# Recovered");
        });
        await slot.findByText(message);
        expect(slot.queryByRole("article")).toBeNull();
        fail = false;
        fireEvent.click(slot.getByRole("button", { name: "Retry" }));
        await slot.findByRole("heading", { name: "Recovered" });
        expect(slot.queryByRole("alert")).toBeNull();
        expect(harness.inspection.sdk.callsTo("files.read")).toHaveLength(2);
        slot.lifecycle.unmount();
      }
    },
  );
  it.each(targets)(
    "reports explicit empty, size, non-text and encoding states for $source.kind with bound Original",
    async (target) => {
      for (const [response, message] of [
        [file(""), "This file is empty."],
        [
          file("not sent to reader", "utf8", 1048577),
          "This file exceeds the 1 MiB reader limit. Use BB preview.",
        ],
        [file("a\0b"), "This file contains non-text control characters. Use BB preview."],
        [file("/w==", "base64", 1), "This file is not valid UTF-8 text. Use BB preview."],
      ] as const) {
        const { slot, harness } = await mount(target, async () => response);
        await slot.findByText(message);
        fireEvent.click(slot.getByRole("button", { name: "Raw" }));
        if (response.content === "") {
          expect(slot.getByLabelText("Raw Markdown").textContent).toBe("");
          expect(slot.queryByRole("button", { name: "Open in BB preview" })).toBeNull();
        } else {
          expect(slot.queryByLabelText("Raw Markdown")).toBeNull();
          fireEvent.click(slot.getByRole("button", { name: "Open in BB preview" }));
          await slot.findByText(`Original for ${target.source.kind}`);
        }
        expect(harness.inspection.sdk.callsTo("files.read")).toHaveLength(1);
        expect(slot.inspection.navigateCalls).toHaveLength(0);
        slot.lifecycle.unmount();
      }
    },
  );
  it.each(targets)(
    "labels $source.kind retained snapshots stale after rejection and clears the label after Retry",
    async (target) => {
      let response = file("# Last snapshot");
      const { slot } = await mount(target, async () => response);
      await slot.findByRole("heading", { name: "Last snapshot" });
      response = file("rejected source", "utf8", 1048577);
      fireEvent.click(slot.getByRole("button", { name: "Refresh" }));
      await slot.findByText("Refresh failed. Showing stale snapshot.");
      expect(slot.getByRole("heading", { name: "Last snapshot" })).toBeTruthy();
      fireEvent.click(slot.getByRole("button", { name: "Raw" }));
      expect(slot.getByLabelText("Raw Markdown").textContent).toBe("# Last snapshot");
      expect(slot.container.textContent).not.toContain("rejected source");
      response = file("# Current");
      fireEvent.click(slot.getByRole("button", { name: "Retry" }));
      await waitFor(() =>
        expect(slot.getByLabelText("Raw Markdown").textContent).toBe("# Current"),
      );
      expect(slot.queryByRole("alert")).toBeNull();
    },
  );
  it.each(targets)(
    "navigates $source.kind source lines without another SDK read or write",
    async (target) => {
      const text = "# Actual\r\n\r\n  Source é  \r\n";
      const { slot, harness, Opener } = await mount(target, async () => file(text), {
        startLineNumber: 3,
        endLineNumber: 3,
      });
      const raw = await slot.findByLabelText("Raw Markdown");
      expect(raw.textContent).toBe(text);
      expect(raw.querySelector('[data-highlighted="true"]')?.textContent).toBe("  Source é  \r\n");
      fireEvent.click(slot.getByRole("button", { name: "Preview" }));
      const heading = await slot.findByRole("heading", { name: "Actual" });
      slot.lifecycle.rerender(
        <Opener
          {...target}
          Original={() => <p>Bound Original</p>}
          experimental_lineRange={{ startLineNumber: 3, endLineNumber: 3 }}
        />,
      );
      expect(slot.getByLabelText("Raw Markdown").textContent).toBe(text);
      fireEvent.click(slot.getByRole("button", { name: "Preview" }));
      expect(slot.getByRole("heading", { name: "Actual" }).id).toBe(heading.id);
      expect(harness.inspection.sdk.callsTo("files.read")).toHaveLength(1);
      expect(harness.inspection.sdk.callsTo("files.write")).toHaveLength(0);
      expect(slot.inspection.navigateCalls).toHaveLength(0);
    },
  );
});
