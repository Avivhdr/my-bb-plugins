import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import plugin from "../app";
import type { ReadResult } from "../source";

const source = {
  kind: "workspace" as const,
  threadId: null,
  environmentId: "env",
  projectId: "project",
  experimental_hostId: "remote",
};
const target = { path: "note.md", source };
const props = { ...target, Original: () => <p>Bound original for note.md</p> };
function ready(text: string, path = target.path): ReadResult {
  return {
    kind: "ready",
    snapshot: {
      text,
      target: { ...target, path },
      sha256: "hash",
      sizeBytes: text.length,
      hostId: "remote",
      rootPath: "/work",
      documentPath: `/work/${path}`,
      documentDirectory: "/work",
    },
  };
}
async function mount(read: () => ReadResult | Promise<ReadResult> = () => ready("# Document")) {
  const app = await loadPluginApp(plugin);
  const slot = renderSlot(app.fileOpeners[0]!, props, { rpc: { read_document: read } });
  return { app, slot };
}
afterEach(cleanup);

describe("rendered reader", () => {
  it("registers only a live md/markdown file opener", async () => {
    const { app, slot } = await mount();
    expect(app.fileOpeners).toHaveLength(1);
    expect(app.fileOpeners[0]!.extensions).toEqual(["md", "markdown"]);
    expect(app.sourceCodeRenderers).toHaveLength(0);
    expect(app.diffRenderers).toHaveLength(0);
    expect(app.contentScripts).toHaveLength(0);
    expect(app.messageDirectives).toHaveLength(0);
    await slot.findByRole("heading", { name: "Document" });
    expect(slot.inspection.rpcCalls).toEqual([{ method: "read_document", input: target }]);
  });
  it("shows the path of the file found by name in the header", async () => {
    const { slot } = await mount(() => ready("# Document", "knowledge/note.md"));
    await slot.findByRole("heading", { name: "Document" });
    expect(slot.getByRole("group", { name: "knowledge/note.md" }).textContent).toBe(
      "note.mdknowledge/",
    );
  });
  it("keeps ready controls grouped without a normal-header Original action", async () => {
    const { slot } = await mount(() => ready("# Document\n\n## Section"));
    await slot.findByRole("heading", { name: "Document" });
    expect(slot.queryByRole("button", { name: "Open in BB preview" })).toBeNull();
    expect(
      within(slot.getByRole("group", { name: "Document view" }))
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual(["Preview", "Raw"]);
    for (const button of within(slot.getByRole("group", { name: "Document view" })).getAllByRole(
      "button",
    )) {
      expect(button.textContent).toBe("");
    }
    expect(
      within(slot.getByRole("group", { name: "Reader actions" }))
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual(["Outline", "Refresh"]);
  });
  it("keeps toolbar icons decorative and hints available to hover and keyboard users", async () => {
    const { slot } = await mount();
    await slot.findByRole("heading", { name: "Document" });
    const controls = slot.getByRole("group", { name: "Document controls" });
    expect(
      Array.from(controls.querySelectorAll("[data-icon]")).map((icon) => [
        icon.getAttribute("data-icon"),
        icon.getAttribute("aria-hidden"),
      ]),
    ).toEqual([
      ["Eye", "true"],
      ["Code", "true"],
      ["ListView", "true"],
      ["RotateCcw", "true"],
    ]);
    const user = userEvent.setup();
    const outline = slot.getByRole("button", { name: "Outline" });
    const refresh = slot.getByRole("button", { name: "Refresh" });
    await user.tab();
    expect(slot.getByRole("tooltip").textContent).toBe("Preview");
    await user.tab();
    expect(slot.getByRole("tooltip").textContent).toBe("Raw");
    await user.tab();
    expect(document.activeElement).toBe(outline);
    expect(slot.getByRole("tooltip").textContent).toBe("Outline");
    expect(outline.getAttribute("aria-describedby")).toBe(slot.getByRole("tooltip").id);
    await user.keyboard("{Escape}");
    expect(slot.queryByRole("tooltip")).toBeNull();
    expect(outline.hasAttribute("aria-describedby")).toBe(false);
    expect(document.activeElement).toBe(outline);
    await user.keyboard(" ");
    expect(outline.getAttribute("aria-pressed")).toBe("false");
    await user.tab();
    expect(document.activeElement).toBe(refresh);
    expect(slot.getByRole("tooltip").textContent).toBe("Refresh");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(slot.inspection.rpcCalls).toHaveLength(2));
    await user.tab();
    expect(slot.queryByRole("tooltip")).toBeNull();
    await user.hover(outline);
    expect(slot.getByRole("tooltip").textContent).toBe("Outline");
    await user.unhover(outline);
    expect(slot.queryByRole("tooltip")).toBeNull();
  });
  it.each(["Outline", "Refresh"])(
    "dismisses a hover-open %s hint with focus elsewhere",
    async (name) => {
      const { slot } = await mount();
      await slot.findByRole("heading", { name: "Document" });
      const user = userEvent.setup();
      const preview = slot.getByRole("button", { name: "Preview" });
      const action = slot.getByRole("button", { name });
      await user.tab();
      expect(document.activeElement).toBe(preview);
      await user.keyboard("{Escape}");
      await user.hover(action);
      expect(slot.getByRole("tooltip").textContent).toBe(name);
      await user.keyboard("{Escape}");
      expect(slot.queryByRole("tooltip")).toBeNull();
      expect(action.hasAttribute("aria-describedby")).toBe(false);
      expect(document.activeElement).toBe(preview);
      expect(slot.inspection.rpcCalls).toHaveLength(1);
      await user.unhover(action);
      await user.hover(action);
      expect(slot.getByRole("tooltip").textContent).toBe(name);
    },
  );
  it.each([
    ["reports/workspace.md", "workspace.md", "reports/"],
    ["/notes/a-very-long-document-name.md", "a-very-long-document-name.md", "/notes/"],
    ["C:\\notes\\document.md", "document.md", "C:\\notes\\"],
    ["note.md", "note.md", ""],
  ])(
    "shows the actual filename and retains complete identity for %s",
    async (path, filename, directory) => {
      const input = {
        path,
        source:
          path.startsWith("/") || path.includes("\\")
            ? { ...source, kind: "host" as const }
            : source,
      };
      const app = await loadPluginApp(plugin);
      const slot = renderSlot(
        app.fileOpeners[0]!,
        { ...input, Original: props.Original },
        {
          rpc: {
            read_document: () => ({
              kind: "ready",
              snapshot: {
                text: "# Identity",
                target: input,
                sha256: "hash",
                sizeBytes: 10,
                hostId: "remote",
                rootPath: "/notes",
                documentPath: path,
                documentDirectory: "/notes",
              },
            }),
          },
        },
      );
      await slot.findByRole("heading", { name: "Identity" });
      const identity = slot.getByRole("group", { name: path });
      expect(identity.getAttribute("title")).toBe(path);
      expect(within(identity).getByText(filename, { exact: true })).toBeTruthy();
      if (directory) expect(within(identity).getByText(directory, { exact: true })).toBeTruthy();
      expect(slot.inspection.rpcCalls).toEqual([{ method: "read_document", input }]);
    },
  );
  it("shows loading, then exact immutable read-only Raw without a view-switch read", async () => {
    let resolve!: (result: ReadResult) => void;
    const pending = new Promise<ReadResult>((r) => {
      resolve = r;
    });
    const { slot } = await mount(() => pending);
    expect(slot.getByRole("status").textContent).toMatch(/Loading/);
    const text =
      '---\r\ntitle: actual\r\n---\r\n# Exact\r\n\r\n```json\r\n{"compact":true}  \r\n```\r\n';
    resolve(ready(text));
    await slot.findByRole("heading", { name: "Exact" });
    fireEvent.click(slot.getByRole("button", { name: "Raw" }));
    const raw = slot.getByLabelText("Raw Markdown");
    expect(raw.textContent).toBe(text);
    expect(raw.hasAttribute("contenteditable")).toBe(false);
    expect(slot.queryByRole("textbox")).toBeNull();
    fireEvent.click(slot.getByRole("button", { name: "Preview" }));
    await slot.findByRole("heading", { name: "Exact" });
    expect(slot.inspection.rpcCalls).toHaveLength(1);
  });
  it("preserves GFM semantics and fenced whitespace without inferred metadata or active destinations", async () => {
    const text =
      '# Plain **document**\n\n## Section\n\n`fulfilled` and ~~removed~~.\n\n> A quote\n\n1. First\n2. Second\n\n- [x] Done\n- [ ] Pending\n\n| Key | Value |\n| --- | --- |\n| real | inconclusive |\n\n```unknown\n  <script>bad()</script>\n{\"compact\":true}  \n```\n\n[sibling](next.md) [external](https://example.com) [unsafe](javascript:alert(1))\n\n![Local alt](image.png) ![Remote alt](https://example.com/image.png)\n\n<script>window.bad = true</script>\n<iframe src="https://example.com"></iframe>\n<img src="x" onerror="bad()">\n';
    const { slot } = await mount(() => ready(text));
    await slot.findByRole("heading", { name: "Plain document", level: 1 });
    expect(slot.getByRole("heading", { name: "Section", level: 2 })).toBeTruthy();
    expect(slot.getByRole("table").textContent).toContain("inconclusive");
    expect(slot.container.querySelector("del")?.textContent).toBe("removed");
    expect(slot.container.querySelector("blockquote")?.textContent).toContain("A quote");
    expect(slot.container.querySelector("ol")?.children).toHaveLength(2);
    const checks = slot.getAllByRole("checkbox") as HTMLInputElement[];
    expect(checks.every((c) => c.disabled)).toBe(true);
    expect(checks.map((c) => c.checked)).toEqual([true, false]);
    expect(slot.container.querySelector("pre code")?.textContent).toBe(
      '  <script>bad()</script>\n{\"compact\":true}  \n',
    );
    expect(
      slot.container.querySelectorAll(
        ".mr-prose a[href], img, script, iframe, .status, .document-meta",
      ),
    ).toHaveLength(0);
    expect(slot.getByText("Local alt")).toBeTruthy();
    expect(slot.getByText("Remote alt")).toBeTruthy();
    expect(slot.inspection.navigateCalls).toHaveLength(0);
  });
  it("reports an empty file and preserves empty Raw", async () => {
    const { slot } = await mount(() => ready(""));
    await slot.findByText("This file is empty.");
    fireEvent.click(slot.getByRole("button", { name: "Raw" }));
    expect(slot.getByLabelText("Raw Markdown").textContent).toBe("");
  });
  it.each(["error", "unsupported"] as const)(
    "offers Retry and bound Original for %s without recursive navigation",
    async (kind) => {
      const { slot } = await mount(() => ({ kind, message: "Cannot read this document." }));
      await slot.findByText("Cannot read this document.");
      expect(slot.container.querySelector(".mr-toolbar")?.textContent).not.toContain(
        "Open in BB preview",
      );
      expect(
        within(slot.getByRole("alert")).getByRole("button", { name: "Open in BB preview" }),
      ).toBeTruthy();
      expect(slot.getByRole("button", { name: "Retry" })).toBeTruthy();
      fireEvent.click(slot.getByRole("button", { name: "Open in BB preview" }));
      await slot.findByText("Bound original for note.md");
      expect(slot.inspection.rpcCalls).toHaveLength(1);
      expect(slot.inspection.navigateCalls).toHaveLength(0);
    },
  );
  it("refreshes both views and marks retained content stale after a failed refresh", async () => {
    let reads = 0;
    const { slot } = await mount(() =>
      ++reads === 1
        ? ready("# First")
        : reads === 2
          ? ready("# Updated")
          : reads === 3
            ? Promise.reject(new Error("Disconnected"))
            : ready("# Recovered"),
    );
    await slot.findByRole("heading", { name: "First" });
    fireEvent.click(slot.getByRole("button", { name: "Raw" }));
    fireEvent.click(slot.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(slot.getByLabelText("Raw Markdown").textContent).toBe("# Updated"));
    fireEvent.click(slot.getByRole("button", { name: "Preview" }));
    await slot.findByRole("heading", { name: "Updated" });
    fireEvent.click(slot.getByRole("button", { name: "Refresh" }));
    await slot.findByText("Disconnected");
    expect(slot.getByRole("alert").textContent).toMatch(/Refresh failed.*stale/i);
    expect(slot.getByRole("heading", { name: "Updated" })).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Raw" }));
    expect(slot.getByLabelText("Raw Markdown").textContent).toBe("# Updated");
    expect(slot.getByRole("alert").textContent).toMatch(/stale/i);
    fireEvent.click(slot.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(slot.getByLabelText("Raw Markdown").textContent).toBe("# Recovered"),
    );
    expect(slot.queryByRole("alert")).toBeNull();
    expect(slot.inspection.rpcCalls).toHaveLength(4);
  });
  it("discards late reads when the target changes or unmounts", async () => {
    let finish!: (r: ReadResult) => void;
    let reads = 0;
    const pending = new Promise<ReadResult>((r) => {
      finish = r;
    });
    const { app, slot } = await mount(() =>
      ++reads === 1 ? pending : ready("# Second", "second.md"),
    );
    const Reader = app.fileOpeners[0]!.component;
    slot.lifecycle.rerender(<Reader {...props} path="second.md" />);
    await slot.findByRole("heading", { name: "Second" });
    finish(ready("# Late first"));
    await waitFor(() => expect(slot.queryByRole("heading", { name: "Late first" })).toBeNull());
    slot.lifecycle.unmount();
  });
  it("does not reload for a newly allocated but identical source", async () => {
    const { app, slot } = await mount();
    await slot.findByRole("heading", { name: "Document" });
    const Reader = app.fileOpeners[0]!.component;
    slot.lifecycle.rerender(<Reader {...props} source={{ ...source }} />);
    await waitFor(() => expect(slot.inspection.rpcCalls).toHaveLength(1));
  });
  it("provides keyboard-operable baseline controls with no theme or outline switch", async () => {
    const { slot } = await mount();
    await slot.findByRole("heading", { name: "Document" });
    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement).toBe(slot.getByRole("button", { name: "Preview" }));
    await user.tab();
    await user.keyboard("{Enter}");
    expect(slot.getByLabelText("Raw Markdown")).toBeTruthy();
    expect(slot.queryByRole("button", { name: /theme|appearance|outline/i })).toBeNull();
  });
  it("ignores a read that finishes after the reader unmounts", async () => {
    let finish!: (result: ReadResult) => void;
    const { slot } = await mount(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    slot.lifecycle.unmount();
    finish(ready("# After unmount"));
    await Promise.resolve();
    expect(document.body.textContent).not.toContain("After unmount");
  });
  it("keeps a fence above the later highlighting budget as exact plain code", async () => {
    const code = "  x".repeat(8000) + "\n";
    const { slot } = await mount(() => ready("```json\n" + code + "```\n"));
    const block = await slot.findByLabelText("Code block");
    expect(block.textContent).toBe(code);
    expect(block.querySelector("span")).toBeNull();
  });
  it("keeps the last snapshot visible but unverified during a refresh", async () => {
    let finish!: (r: ReadResult) => void;
    let reads = 0;
    const { slot } = await mount(() =>
      ++reads === 1
        ? ready("# Previous")
        : new Promise((resolve) => {
            finish = resolve;
          }),
    );
    await slot.findByRole("heading", { name: "Previous" });
    fireEvent.click(slot.getByRole("button", { name: "Refresh" }));
    expect(slot.getByRole("status").textContent).toMatch(/Refreshing.*not verified current/i);
    expect(slot.getByRole("heading", { name: "Previous" })).toBeTruthy();
    finish(ready("# Latest"));
    await slot.findByRole("heading", { name: "Latest" });
    expect(slot.queryByRole("status")).toBeNull();
  });
  it.each(["initial", "refresh"])(
    "sequences overlapping %s requests and ignores late failures",
    async (phase) => {
      const pending: { resolve: (r: ReadResult) => void; reject: (e: Error) => void }[] = [];
      let reads = 0;
      const { slot } = await mount(() => {
        if (phase === "refresh" && ++reads === 1) return ready("# First");
        return new Promise((resolve, reject) => {
          pending.push({ resolve, reject });
        });
      });
      if (phase === "refresh") {
        await slot.findByRole("heading", { name: "First" });
        fireEvent.click(slot.getByRole("button", { name: "Refresh" }));
      }
      fireEvent.click(slot.getByRole("button", { name: "Refresh" }));
      expect(pending).toHaveLength(2);
      pending[1]!.resolve(ready("# Latest"));
      await slot.findByRole("heading", { name: "Latest" });
      pending[0]!.reject(new Error("Late failure"));
      await waitFor(() => expect(slot.queryByRole("alert")).toBeNull());
      expect(slot.getByRole("heading", { name: "Latest" })).toBeTruthy();
    },
  );
  it("does not replace the latest refresh with an older successful refresh", async () => {
    const pending: ((r: ReadResult) => void)[] = [];
    let reads = 0;
    const { slot } = await mount(() =>
      ++reads === 1
        ? ready("# First")
        : new Promise((resolve) => {
            pending.push(resolve);
          }),
    );
    await slot.findByRole("heading", { name: "First" });
    fireEvent.click(slot.getByRole("button", { name: "Refresh" }));
    fireEvent.click(slot.getByRole("button", { name: "Refresh" }));
    expect(pending).toHaveLength(2);
    pending[1]!(ready("# Latest"));
    await slot.findByRole("heading", { name: "Latest" });
    pending[0]!(ready("# Old refresh"));
    await waitFor(() => expect(slot.queryByRole("heading", { name: "Old refresh" })).toBeNull());
    expect(slot.getByRole("heading", { name: "Latest" })).toBeTruthy();
  });
  it("keeps Original unavailable during refresh and discards late results after unmount", async () => {
    let finish!: (r: ReadResult) => void;
    let reads = 0;
    const { slot } = await mount(() =>
      ++reads === 1
        ? ready("# First")
        : new Promise((resolve) => {
            finish = resolve;
          }),
    );
    await slot.findByRole("heading", { name: "First" });
    fireEvent.click(slot.getByRole("button", { name: "Refresh" }));
    expect(slot.queryByRole("button", { name: "Open in BB preview" })).toBeNull();
    slot.lifecycle.unmount();
    finish(ready("# Late refresh"));
    await Promise.resolve();
    expect(slot.queryByRole("heading", { name: "Late refresh" })).toBeNull();
    expect(slot.inspection.rpcCalls).toHaveLength(2);
    expect(slot.inspection.navigateCalls).toHaveLength(0);
  });
  it("isolates rapid source and host identity changes even when the path stays the same", async () => {
    const finishes: ((r: ReadResult) => void)[] = [];
    const { app, slot } = await mount(
      () =>
        new Promise((resolve) => {
          finishes.push(resolve);
        }),
    );
    const Reader = app.fileOpeners[0]!.component;
    slot.lifecycle.rerender(
      <Reader {...props} source={{ ...source, experimental_hostId: "other-remote" }} />,
    );
    slot.lifecycle.rerender(
      <Reader
        {...props}
        source={{
          ...source,
          kind: "thread-storage",
          threadId: "other-thread",
          environmentId: null,
        }}
      />,
    );
    expect(finishes).toHaveLength(3);
    finishes[2]!(ready("# Latest source"));
    await slot.findByRole("heading", { name: "Latest source" });
    finishes[1]!(ready("# Wrong host"));
    finishes[0]!(ready("# First source"));
    await Promise.resolve();
    expect(slot.queryByRole("heading", { name: "Wrong host" })).toBeNull();
    expect(slot.queryByRole("heading", { name: "First source" })).toBeNull();
    expect(slot.getByRole("heading", { name: "Latest source" })).toBeTruthy();
  });
  it("discards a pending refresh after unmount, including its rejection", async () => {
    let reject!: (e: Error) => void;
    let reads = 0;
    const { slot } = await mount(() =>
      ++reads === 1
        ? ready("# First")
        : new Promise((_, r) => {
            reject = r;
          }),
    );
    await slot.findByRole("heading", { name: "First" });
    fireEvent.click(slot.getByRole("button", { name: "Refresh" }));
    slot.lifecycle.unmount();
    reject(new Error("After unmount"));
    await Promise.resolve();
    expect(document.body.textContent).not.toContain("After unmount");
    expect(slot.inspection.rpcCalls).toHaveLength(2);
  });
  it("keeps highlighted Preview and complete exact Raw on the same frontend snapshot", async () => {
    const text =
      '# Highlighted\r\n\r\n```json\r\n{"compact":true}  \r\n```\r\n\r\n```js\r\n\tconst value = true;\r\n```\r\n';
    const { slot } = await mount(() => ready(text));
    await slot.findByRole("heading", { name: "Highlighted" });
    expect(slot.container.querySelectorAll("pre .token").length).toBeGreaterThan(0);
    expect(slot.getAllByLabelText("Code block").map((b) => b.textContent)).toEqual([
      '{"compact":true}  \n',
      "\tconst value = true;\n",
    ]);
    const user = userEvent.setup();
    await user.tab();
    await user.tab();
    await user.keyboard(" ");
    expect(slot.getByLabelText("Raw Markdown").textContent).toBe(text);
    await user.tab({ shift: true });
    await user.keyboard("{Enter}");
    expect(slot.getByRole("heading", { name: "Highlighted" })).toBeTruthy();
    expect(slot.inspection.rpcCalls.filter((c) => c.method === "read_document")).toHaveLength(1);
  });
});
