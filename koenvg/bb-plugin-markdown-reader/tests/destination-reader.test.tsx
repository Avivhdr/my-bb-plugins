import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import pluginApp from "../app";
import pluginServer from "../server";
import { destinationsResultSchema, readResultSchema, type ReaderTarget } from "../source";

const targets: ReaderTarget[] = [
  {
    path: "reports/note.md",
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
    path: "reports/note.md",
    source: { kind: "thread-storage", threadId: "thread", environmentId: null, projectId: null },
  },
];
const disposers: (() => Promise<void>)[] = [];
afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const dispose of disposers.splice(0)) await dispose();
});
async function mount(
  target = targets[0]!,
  text = "# Note",
  resolve?: (
    result: import("../destination-types").DestinationResult,
  ) => Promise<import("../destination-types").DestinationResult>,
) {
  let readFailure = false;
  const { bb, harness } = createFakePluginHost({
    pluginId: "markdown-reader",
    experimental_callHostRpc: async ({ input }) => input,
    sdk: {
      threads: {
        get: async () => ({ id: "thread", projectId: "project", environmentId: "env" }),
        storageLocation: async () => ({ hostId: "remote", storageRootPath: "/actual/storage" }),
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
        read: async () => {
          if (readFailure) throw new Error("Source disconnected");
          return {
            content: text,
            contentEncoding: "utf8",
            sha256: "unchanged",
            sizeBytes: text.length,
          };
        },
      },
    },
  });
  disposers.push(() => harness.lifecycle.dispose());
  pluginServer(bb);
  const app = await loadPluginApp(pluginApp);
  const Opener = app.fileOpeners[0]!.component;
  const slot = renderSlot(
    app.fileOpeners[0]!,
    { ...target, Original: () => <p>Bound Original</p> },
    {
      rpc: {
        read_document: async (input) =>
          readResultSchema.parse(await harness.behavior.callRpc("read_document", input)),
        resolve_destinations: async (input) => {
          const result = destinationsResultSchema.parse(
            await harness.behavior.callRpc("resolve_destinations", input),
          );
          return resolve ? resolve(result) : result;
        },
      },
      openUrl: () => true,
      openFilePreview: () => true,
    },
  );
  return {
    slot,
    harness,
    Opener,
    failRead: () => {
      readFailure = true;
    },
  };
}

describe("rendered destinations and source-owned image transport", () => {
  it.each(targets)(
    "activates real $source.kind anchors with the actual identity and no speculative file read",
    async (target) => {
      const text =
        "# Note\n\n[sibling](next.md) [local](./note.md#note) [web](https://example.com/guide)\n\n![Local alt](picture.png) ![Remote alt](https://images.test/picture.png)\n";
      const { slot, harness } = await mount(target, text);
      const sibling = await slot.findByRole("link", { name: "sibling" });
      expect(sibling.tagName).toBe("A");
      expect(sibling.getAttribute("href")).toBeTruthy();
      fireEvent.click(sibling);
      const expected =
        target.source.kind === "workspace"
          ? { kind: "workspace", environmentId: "env", path: "reports/next.md" }
          : target.source.kind === "host"
            ? { kind: "host", hostId: "remote", path: "/notes/next.md" }
            : { kind: "thread-storage", threadId: "thread", path: "reports/next.md" };
      expect(slot.inspection.navigateCalls).toContainEqual({
        method: "experimental_openFilePreview",
        options: { target: expected, location: null },
      });
      const before = slot.inspection.navigateCalls.length;
      fireEvent.click(slot.getByRole("link", { name: "local" }));
      expect(slot.inspection.navigateCalls).toHaveLength(before);
      expect(document.activeElement).toBe(slot.getByRole("heading", { name: "Note" }));
      fireEvent.click(slot.getByRole("link", { name: "web" }));
      expect(slot.inspection.navigateCalls).toContainEqual({
        method: "openUrl",
        url: "https://example.com/guide",
      });
      const image = await slot.findByRole("img", { name: "Local alt" });
      expect(image.getAttribute("src")).toMatch(
        /^\/api\/v1\/plugins\/markdown-reader\/http\/image\?asset=/,
      );
      expect(image.getAttribute("src")).not.toMatch(/remote|\/notes|\/work|\/actual/);
      expect(slot.getByRole("img", { name: "Remote alt" }).getAttribute("src")).toBe(
        "https://images.test/picture.png",
      );
      expect(harness.inspection.sdk.callsTo("files.read")).toHaveLength(1);
      expect(harness.inspection.sdk.callsTo("files.createPreview")).toHaveLength(0);
      fireEvent.click(slot.getByRole("button", { name: "Raw" }));
      expect(slot.getByLabelText("Raw Markdown").textContent).toBe(text);
    },
  );
  it("keeps lexical rejections readable with no href/src, preview allocation or navigation", async () => {
    const urls = [
      "javascript:alert(1)",
      "data:image/svg+xml,bad",
      "file:///etc/passwd",
      "%2e%2e/out.png",
      "../../out.png",
      "%zz",
      "https:/broken",
      "image.svg",
    ];
    const text =
      "# Note\n\n" +
      urls.map((u, i) => `[link ${i}](${u}) ![alt ${i}](${u})`).join("\n\n") +
      '\n\n<script>bad()</script>\n<iframe src="https://example.com"></iframe>';
    const { slot, harness } = await mount(targets[0], text);
    await slot.findByRole("heading", { name: "Note" });
    await waitFor(() =>
      expect(slot.inspection.rpcCalls.some((c) => c.method === "resolve_destinations")).toBe(true),
    );
    for (let i = 0; i < urls.length; i++) {
      const link = slot.getByText(`link ${i}`);
      if (urls[i] !== "image.svg") expect(link.tagName).toBe("SPAN");
      fireEvent.click(link);
      expect(slot.getByText(`alt ${i}`)).toBeTruthy();
    }
    // SVG remains a normal local file link, but never an image.
    expect(slot.container.querySelectorAll("img,script,iframe")).toHaveLength(0);
    expect(harness.inspection.sdk.callsTo("files.createPreview")).toHaveLength(0);
    expect(harness.inspection.sdk.callsTo("files.read")).toHaveLength(1);
    expect(
      slot.inspection.navigateCalls.every((c) => c.method === "experimental_openFilePreview"),
    ).toBe(true);
  });
  it("retains accessible keyboard activation and SDK-owned modifier behavior", async () => {
    const { slot } = await mount(
      targets[0],
      "# Note\n\n[web](https://example.com/) [file](next.md)",
    );
    const web = await slot.findByRole("link", { name: "web" });
    const file = slot.getByRole("link", { name: "file" });
    for (const element of [web, file]) {
      fireEvent.click(element, { ctrlKey: true });
      fireEvent.click(element, { metaKey: true });
      fireEvent(
        element,
        new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true }),
      );
    }
    expect(slot.inspection.navigateCalls).toHaveLength(0);
    web.focus();
    await userEvent.setup().keyboard("{Enter}");
    expect(slot.inspection.navigateCalls).toContainEqual({
      method: "openUrl",
      url: "https://example.com/",
    });
    file.focus();
    await userEvent.setup().keyboard("{Enter}");
    expect(slot.inspection.navigateCalls).toHaveLength(2);
  });
  it("deduplicates within a snapshot and refreshes URLs without view-switch requests", async () => {
    const { slot, harness } = await mount(
      targets[0],
      "# Note\n\n![first](a.png) ![second](./a.png)",
    );
    const first = await slot.findByRole("img", { name: "first" });
    const src = first.getAttribute("src");
    expect(src).toBe(slot.getByRole("img", { name: "second" }).getAttribute("src"));
    fireEvent.click(slot.getByRole("button", { name: "Raw" }));
    fireEvent.click(slot.getByRole("button", { name: "Preview" }));
    expect(
      slot.inspection.rpcCalls.filter((c) => c.method === "resolve_destinations"),
    ).toHaveLength(1);
    fireEvent.click(slot.getByRole("button", { name: "Refresh" }));
    await waitFor(() =>
      expect(slot.getByRole("img", { name: "first" }).getAttribute("src")).not.toBe(src),
    );
    expect(
      slot.inspection.rpcCalls.filter((c) => c.method === "resolve_destinations"),
    ).toHaveLength(2);
    expect(harness.inspection.sdk.callsTo("files.createPreview")).toHaveLength(0);
  });
  it("leaves readable alt/error content after a confined asset request fails, then Refresh recovers", async () => {
    const { slot, harness } = await mount(
      targets[0],
      "# Note\n\nSurrounding text.\n\n![Symlink alt](escape.png)",
    );
    const image = await slot.findByRole("img", { name: "Symlink alt" });
    // Simulated SDK-confined GET denial. An attempted content request is permitted.
    fireEvent.error(image);
    expect(slot.queryByRole("img", { name: "Symlink alt" })).toBeNull();
    expect(slot.getByText("Symlink alt")).toBeTruthy();
    expect(slot.getByText(/Image unavailable/)).toBeTruthy();
    expect(slot.getByText("Surrounding text.")).toBeTruthy();
    expect(harness.inspection.sdk.callsTo("files.createPreview")).toHaveLength(0);
    fireEvent.click(slot.getByRole("button", { name: "Refresh" }));
    await slot.findByRole("img", { name: "Symlink alt" });
  });
  it("discards late image URLs on source switching and unmount without cross-source reuse", async () => {
    const pending: {
      result: import("../destination-types").DestinationResult;
      complete: () => void;
    }[] = [];
    const { slot, Opener } = await mount(
      targets[0],
      "# Note\n\n![Picture](a.png)",
      (result) =>
        new Promise((resolve) => pending.push({ result, complete: () => resolve(result) })),
    );
    await waitFor(() => expect(pending).toHaveLength(1));
    slot.lifecycle.rerender(<Opener {...targets[1]!} Original={() => <p>Bound Original</p>} />);
    await waitFor(() => expect(pending).toHaveLength(2));
    pending[1]!.complete();
    const image = await slot.findByRole("img", { name: "Picture" });
    const src = image.getAttribute("src");
    pending[0]!.complete();
    await Promise.resolve();
    expect(slot.getByRole("img", { name: "Picture" }).getAttribute("src")).toBe(src);
    expect(pending[0]!.result.identity?.rootPath).toBe("/work");
    expect(pending[1]!.result.identity?.rootPath).toBe("/notes");
    fireEvent.click(slot.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(pending).toHaveLength(3));
    slot.lifecycle.unmount();
    pending[2]!.complete();
    await Promise.resolve();
    expect(document.querySelector("img")).toBeNull();
  });
  it("removes stale image sources during Refresh and a failed read, while keeping readable stale text", async () => {
    const { slot, failRead } = await mount(
      targets[0],
      "# Note\n\nStale paragraph.\n\n![Stale alt](a.png)",
    );
    await slot.findByRole("img", { name: "Stale alt" });
    failRead();
    fireEvent.click(slot.getByRole("button", { name: "Refresh" }));
    expect(slot.queryByRole("img")).toBeNull();
    await slot.findByRole("alert");
    expect(slot.queryByRole("img")).toBeNull();
    expect(slot.getByText("Stale paragraph.")).toBeTruthy();
  });
  it("keeps local images visible after a day without timers or extra requests", async () => {
    vi.useFakeTimers();
    let mounted!: Awaited<ReturnType<typeof mount>>;
    await act(async () => {
      mounted = await mount(targets[0], "# Note\n\n![Persistent alt](a.png)");
    });
    const image = mounted.slot.getByRole("img");
    const src = image.getAttribute("src");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(86400000);
    });
    expect(mounted.slot.getByRole("img")).toBe(image);
    expect(image.getAttribute("src")).toBe(src);
    expect(
      mounted.slot.inspection.rpcCalls.filter((c) => c.method === "resolve_destinations"),
    ).toHaveLength(1);
    expect(mounted.harness.inspection.sdk.callsTo("files.createPreview")).toHaveLength(0);
    mounted.slot.lifecycle.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(targets)(
    "keeps encoded external separator traversal inert for $source.kind while valid peers work",
    async (target) => {
      const urls = [
        "https://images.test/%2e%2e%2fpicture.png",
        "https://images.test/a%2f..%2fpicture.png",
        "https://example.com/a%2f%2e%2e/guide",
      ];
      const text =
        urls.map((url, i) => `[rejected ${i}](${url}) ![blocked ${i}](${url})`).join("\n\n") +
        "\n\n[sibling](next.md)";
      const { slot, harness } = await mount(target, text);
      await slot.findByRole("link", { name: "sibling" });
      for (let i = 0; i < urls.length; i++) {
        const label = slot.getByText(`rejected ${i}`);
        expect(label.tagName).toBe("SPAN");
        fireEvent.click(label);
        expect(slot.getByText(`blocked ${i}`)).toBeTruthy();
      }
      expect(slot.container.querySelectorAll("img")).toHaveLength(0);
      expect(slot.inspection.navigateCalls).toHaveLength(0);
      expect(harness.inspection.sdk.callsTo("files.createPreview")).toHaveLength(0);
      expect(harness.inspection.sdk.callsTo("files.read")).toHaveLength(1);
    },
  );
  it.each(targets)(
    "rejects oversized URLs individually for $source.kind without disabling a sibling or image",
    async (target) => {
      const oversized = "https://example.com/" + "a".repeat(4100);
      const text = `[oversized](${oversized}) ![Oversized alt](${oversized}) [sibling](next.md) ![Good alt](picture.png)`;
      const { slot, harness } = await mount(target, text);
      expect((await slot.findByRole("link", { name: "sibling" })).tagName).toBe("A");
      expect(slot.getByText("oversized").tagName).toBe("SPAN");
      expect(slot.getByText("Oversized alt")).toBeTruthy();
      expect((await slot.findByRole("img", { name: "Good alt" })).getAttribute("src")).toContain(
        "/api/v1/plugins/markdown-reader/http/image?asset=",
      );
      expect(slot.container.querySelectorAll("img")).toHaveLength(1);
      expect(slot.inspection.navigateCalls).toHaveLength(0);
      expect(harness.inspection.sdk.callsTo("files.createPreview")).toHaveLength(0);
      const resolution = slot.inspection.rpcCalls.find((c) => c.method === "resolve_destinations")!;
      expect(JSON.stringify(resolution)).not.toContain(oversized);
      fireEvent.click(slot.getByRole("button", { name: "Raw" }));
      expect(slot.getByLabelText("Raw Markdown").textContent).toBe(text);
    },
  );
});
