import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import plugin from "../app";
import type { ReadResult } from "../source";

const source = {
  kind: "workspace" as const,
  threadId: null,
  environmentId: "env",
  projectId: "project",
};
const props = { path: "note.md", source, Original: () => <p>Bound original</p> };
const text =
  "# Title\n\n## **日本語** `code` [link](next.md)\n\n## 日本語 code link\n\n[second](#%E6%97%A5%E6%9C%AC%E8%AA%9E-code-link-1) [file](next.md#title) [bad](#%zz)\n";
function ready(text: string): ReadResult {
  return {
    kind: "ready",
    snapshot: {
      text,
      target: { path: props.path, source },
      sha256: "hash",
      sizeBytes: text.length,
      hostId: "remote",
      rootPath: "/work",
      documentPath: "/work/note.md",
      documentDirectory: "/work",
    },
  };
}
async function mount(content = text) {
  const app = await loadPluginApp(plugin);
  const slot = renderSlot(app.fileOpeners[0]!, props, {
    rpc: { read_document: () => ready(content) },
  });
  if (content === "") await slot.findByText("This file is empty.");
  else await slot.findByRole("article");
  return { slot, Opener: app.fileOpeners[0]!.component };
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("local heading navigation", () => {
  it("offers a closed inline disclosure, keyboard outline navigation, and hide/reclaim control", async () => {
    const { slot } = await mount();
    const disclosure = slot.container.querySelector("details")!;
    expect(disclosure).not.toBeNull();
    expect(disclosure.open).toBe(false);
    const user = userEvent.setup();
    const summary = within(disclosure).getByText("On this page");
    summary.focus();
    await user.keyboard("{Enter}");
    // jsdom does not implement native details keyboard default. Browser checks do.
    fireEvent.click(summary);
    const entries = within(disclosure).getAllByRole("link", { name: "日本語 code link" });
    entries[1]!.focus();
    await user.keyboard("{Enter}");
    expect(document.activeElement).toBe(
      slot.getAllByRole("heading", { name: "日本語 code link" })[1],
    );
    fireEvent.click(slot.getByRole("button", { name: "Outline" }));
    expect(slot.container.querySelector("details, .mr-outline-aside")).toBeNull();
    expect(slot.getByRole("button", { name: "Outline" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(slot.inspection.rpcCalls.filter((c) => c.method === "read_document")).toHaveLength(1);
  });
  it("keeps fragment navigation and focus inside the activated reader with unique heading IDs", async () => {
    const first = await mount();
    const second = await mount();
    const firstHeadings = within(first.slot.container).getAllByRole("heading");
    const secondHeadings = within(second.slot.container).getAllByRole("heading");
    expect(new Set([...firstHeadings, ...secondHeadings].map((h) => h.id)).size).toBe(6);
    const link = within(second.slot.container).getByRole("link", { name: "second" });
    expect(link.getAttribute("href")).toBe(`#${secondHeadings[2]!.id}`);
    link.focus();
    await userEvent.setup().keyboard("{Enter}");
    expect(document.activeElement).toBe(secondHeadings[2]);
    expect(firstHeadings).not.toContain(document.activeElement);
    expect(location.hash).toBe("");
    expect(within(second.slot.container).queryByRole("link", { name: "file" })).toBeNull();
    expect(within(second.slot.container).queryByRole("link", { name: "bad" })).toBeNull();
    expect(second.slot.inspection.navigateCalls).toHaveLength(0);
    expect(
      second.slot.inspection.rpcCalls.filter((c) => c.method === "read_document"),
    ).toHaveLength(1);
  });
  it("omits the outline and its toggle when there are no rendered headings", async () => {
    const { slot } = await mount("Plain text\n\n```md\n# Fenced\n```\n\n<h1>Hidden</h1>");
    expect(slot.queryByRole("heading")).toBeNull();
    expect(slot.queryByRole("button", { name: "Outline" })).toBeNull();
    expect(slot.container.querySelector("details, aside")).toBeNull();
  });
  it("applies the latest initial line intent after load and repeats equal values without a read or model replacement", async () => {
    const app = await loadPluginApp(plugin);
    const Opener = app.fileOpeners[0]!.component;
    let finish!: (result: ReadResult) => void;
    const initial = { startLineNumber: 2, endLineNumber: 3 };
    const sourceText =
      "---\r\ntitle: é\r\n---\r\n# 日本語\r\n\r\n```text\r\n  " +
      "long ".repeat(100) +
      "\r\n```\r\n";
    const slot = renderSlot(
      app.fileOpeners[0]!,
      { ...props, experimental_lineRange: initial },
      {
        rpc: {
          read_document: () =>
            new Promise<ReadResult>((resolve) => {
              finish = resolve;
            }),
        },
      },
    );
    expect(slot.getByRole("button", { name: "Raw" }).getAttribute("aria-pressed")).toBe("true");
    const request = { startLineNumber: 7, endLineNumber: 7 };
    slot.lifecycle.rerender(<Opener {...props} experimental_lineRange={request} />);
    expect(slot.inspection.rpcCalls.filter((c) => c.method === "read_document")).toHaveLength(1);
    finish(ready(sourceText));
    const raw = await slot.findByLabelText("Raw Markdown");
    const line = raw.querySelector<HTMLElement>('[data-source-line="7"]')!;
    await waitFor(() => expect(document.activeElement).toBe(line));
    expect(raw.textContent).toBe(sourceText);
    expect(raw.querySelectorAll('[data-highlighted="true"]')).toHaveLength(1);
    expect(line.textContent).toBe("  " + "long ".repeat(100) + "\r\n");
    slot.getByRole("button", { name: "Raw" }).focus();
    slot.lifecycle.rerender(<Opener {...props} experimental_lineRange={{ ...request }} />);
    await waitFor(() => expect(document.activeElement).toBe(line));
    expect(slot.getByLabelText("Raw Markdown")).toBe(raw);
    expect(raw.querySelector('[data-source-line="7"]')).toBe(line);
    const changed = { startLineNumber: 100, endLineNumber: 3 };
    slot.lifecycle.rerender(<Opener {...props} experimental_lineRange={changed} />);
    expect(raw.querySelectorAll('[data-highlighted="true"]')).toHaveLength(7);
    fireEvent.click(slot.getByRole("button", { name: "Preview" }));
    const heading = slot.getByRole("heading", { name: "日本語" });
    const headingId = heading.id;
    slot.lifecycle.rerender(
      <Opener {...props} source={{ ...source }} experimental_lineRange={changed} />,
    );
    expect(slot.getByRole("heading", { name: "日本語" })).toBe(heading);
    fireEvent.click(slot.getByRole("button", { name: "Raw" }));
    expect(slot.getByLabelText("Raw Markdown").textContent).toBe(sourceText);
    slot.lifecycle.rerender(<Opener {...props} experimental_lineRange={{ ...changed }} />);
    expect(slot.getByRole("button", { name: "Raw" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(slot.getByRole("button", { name: "Preview" }));
    expect(slot.getByRole("heading", { name: "日本語" }).id).toBe(headingId);
    expect(slot.inspection.rpcCalls.filter((c) => c.method === "read_document")).toHaveLength(1);
  });
  it("uses measured reader width for the aside, retains the hide choice, and disposes its observer on fallback", async () => {
    let resize!: ResizeObserverCallback;
    let observed!: Element;
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resize = callback;
        }
        observe(element: Element) {
          observed = element;
        }
        disconnect = disconnect;
      },
    );
    let result: ReadResult = ready(text);
    const app = await loadPluginApp(plugin);
    const slot = renderSlot(app.fileOpeners[0]!, props, { rpc: { read_document: () => result } });
    await slot.findByRole("article");
    const panel = slot.getByRole("region", { name: "Markdown Reader" });
    expect(observed).toBe(panel);
    const size = (width: number) =>
      act(() =>
        resize(
          [
            {
              target: panel,
              contentRect: DOMRectReadOnly.fromRect({ width }),
              borderBoxSize: [],
              contentBoxSize: [],
              devicePixelContentBoxSize: [],
            },
          ],
          {} as ResizeObserver,
        ),
      );
    size(1080);
    expect(slot.container.querySelector("details")?.open).toBe(false);
    size(1081);
    expect(slot.getByRole("complementary", { name: "On this page" })).toBeTruthy();
    expect(slot.container.querySelector("details")).toBeNull();
    fireEvent.click(slot.getByRole("button", { name: "Outline" }));
    expect(slot.container.querySelector(".mr-document-layout")?.getAttribute("data-outline")).toBe(
      "hidden",
    );
    size(390);
    expect(slot.container.querySelector("details, aside")).toBeNull();
    fireEvent.click(slot.getByRole("button", { name: "Outline" }));
    expect(slot.container.querySelector("details")?.open).toBe(false);
    expect(slot.queryByRole("button", { name: "Open in BB preview" })).toBeNull();
    result = { kind: "error", message: "Read failed" };
    fireEvent.click(slot.getByRole("button", { name: "Refresh" }));
    await slot.findByText("Read failed");
    fireEvent.click(slot.getByRole("button", { name: "Open in BB preview" }));
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(slot.inspection.rpcCalls.filter((c) => c.method === "read_document")).toHaveLength(2);
  });
  it.each(["", "first\r\nsecond\r\n"])(
    "keeps empty or clamped Raw safe and clears a removed request for %j",
    async (content) => {
      const { slot, Opener } = await mount(content);
      slot.lifecycle.rerender(
        <Opener {...props} experimental_lineRange={{ startLineNumber: -50, endLineNumber: 500 }} />,
      );
      const raw = slot.getByLabelText("Raw Markdown");
      expect(raw.textContent).toBe(content);
      expect(raw.querySelectorAll('[data-highlighted="true"]')).toHaveLength(content ? 3 : 0);
      slot.lifecycle.rerender(<Opener {...props} experimental_lineRange={null} />);
      expect(raw.querySelectorAll('[data-highlighted="true"]')).toHaveLength(0);
      expect(slot.inspection.rpcCalls.filter((c) => c.method === "read_document")).toHaveLength(1);
    },
  );
  it("targets a replacement source while ignoring the old pending read", async () => {
    const app = await loadPluginApp(plugin);
    const Opener = app.fileOpeners[0]!.component;
    const finishes: ((result: ReadResult) => void)[] = [];
    const slot = renderSlot(
      app.fileOpeners[0]!,
      { ...props, experimental_lineRange: { startLineNumber: 1, endLineNumber: 1 } },
      {
        rpc: { read_document: () => new Promise<ReadResult>((resolve) => finishes.push(resolve)) },
      },
    );
    slot.lifecycle.rerender(
      <Opener
        {...props}
        path="other.md"
        experimental_lineRange={{ startLineNumber: 2, endLineNumber: 2 }}
      />,
    );
    finishes[1]!(ready("Current\nSecond\n"));
    const raw = await slot.findByLabelText("Raw Markdown");
    expect(raw.querySelector('[data-highlighted="true"]')?.getAttribute("data-source-line")).toBe(
      "2",
    );
    finishes[0]!(ready("Wrong source"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(raw.textContent).toBe("Current\nSecond\n");
    expect(slot.inspection.rpcCalls.filter((c) => c.method === "read_document")).toHaveLength(2);
    expect(slot.queryByRole("button", { name: "Open in BB preview" })).toBeNull();
    fireEvent.click(slot.getByRole("button", { name: "Refresh" }));
    finishes[2]!({ kind: "error", message: "Replacement source read failed" });
    await slot.findByText("Replacement source read failed");
    fireEvent.click(slot.getByRole("button", { name: "Open in BB preview" }));
    expect(slot.getByText("Bound original")).toBeTruthy();
  });
  it("treats an equal request before the read finishes as the latest intent without refetching", async () => {
    const app = await loadPluginApp(plugin);
    const Opener = app.fileOpeners[0]!.component;
    let finish!: (result: ReadResult) => void;
    const request = { startLineNumber: 2, endLineNumber: 2 };
    const slot = renderSlot(
      app.fileOpeners[0]!,
      { ...props, experimental_lineRange: request },
      {
        rpc: {
          read_document: () =>
            new Promise<ReadResult>((resolve) => {
              finish = resolve;
            }),
        },
      },
    );
    fireEvent.click(slot.getByRole("button", { name: "Preview" }));
    slot.lifecycle.rerender(<Opener {...props} experimental_lineRange={{ ...request }} />);
    expect(slot.getByRole("button", { name: "Raw" }).getAttribute("aria-pressed")).toBe("true");
    finish(ready("First\nSecond"));
    const raw = await slot.findByLabelText("Raw Markdown");
    expect(raw.querySelector('[data-highlighted="true"]')?.textContent).toBe("Second");
    expect(slot.inspection.rpcCalls.filter((c) => c.method === "read_document")).toHaveLength(1);
  });
  it.each([1.5, NaN, Infinity])(
    "does not highlight malformed numeric line bounds %s",
    async (startLineNumber) => {
      const { slot, Opener } = await mount();
      slot.lifecycle.rerender(
        <Opener {...props} experimental_lineRange={{ startLineNumber, endLineNumber: 2 }} />,
      );
      const raw = slot.getByLabelText("Raw Markdown");
      expect(raw.textContent).toBe(text);
      expect(raw.querySelectorAll('[data-highlighted="true"]')).toHaveLength(0);
      expect(slot.inspection.rpcCalls.filter((c) => c.method === "read_document")).toHaveLength(1);
      fireEvent.click(slot.getByRole("button", { name: "Preview" }));
      expect(slot.getByRole("article")).toBeTruthy();
    },
  );
  it.each(["", "# Actual\r\n\r\n"])(
    "loads used footnotes in initial targeted Raw and keeps the source outline correct for prefix %j",
    async (prefix) => {
      const app = await loadPluginApp(plugin);
      const content = prefix + "Text[^1]\r\n\r\n[^1]: Note é.\r\n";
      const slot = renderSlot(
        app.fileOpeners[0]!,
        { ...props, experimental_lineRange: { startLineNumber: 1, endLineNumber: 1 } },
        { rpc: { read_document: () => ready(content) } },
      );
      const raw = await slot.findByLabelText("Raw Markdown");
      expect(raw.textContent).toBe(content);
      expect(raw.querySelector('[data-highlighted="true"]')?.getAttribute("data-source-line")).toBe(
        "1",
      );
      fireEvent.click(slot.getByRole("button", { name: "Preview" }));
      expect(slot.getByRole("article").textContent).toContain("Note é.");
      if (prefix) {
        expect(slot.getByRole("button", { name: "Outline" })).toBeTruthy();
        const disclosure = slot.container.querySelector("details")!;
        fireEvent.click(within(disclosure).getByText("On this page"));
        expect(
          within(disclosure)
            .getAllByRole("link")
            .map((e) => e.textContent),
        ).toEqual(["Actual"]);
      } else {
        expect(slot.queryByRole("button", { name: "Outline" })).toBeNull();
        expect(slot.container.querySelector("details, aside")).toBeNull();
      }
      expect(
        slot.getAllByRole("link").every((link) => link.getAttribute("href")?.startsWith("#")),
      ).toBe(true);
      fireEvent.click(slot.getByRole("button", { name: "Raw" }));
      expect(slot.getByLabelText("Raw Markdown").textContent).toBe(content);
      expect(slot.inspection.rpcCalls.filter((c) => c.method === "read_document")).toHaveLength(1);
    },
  );
});
