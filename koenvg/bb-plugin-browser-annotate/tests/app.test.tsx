import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { ExperimentalPluginBrowserToolbarActionProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot, type RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import definition from "../app";
import type { rpcContract } from "../lib/contract";

const app = await loadPluginApp(definition);
const toolbar = app.browserToolbarActions[0]!;

afterEach(cleanup);

function fakePage() {
  let installed = false;
  return {
    evaluate: vi.fn(async (script: string) => {
      if (script.includes("bb.postMessage")) installed = true;
      return installed;
    }),
    onMessage: vi.fn(() => () => {}),
  };
}

type Rpc = NonNullable<RenderSlotOptions<typeof rpcContract>["rpc"]>;

function rpc(): Rpc {
  return {
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(async () => ({ removed: [] })),
    listForUrl: vi.fn(async () => []),
    listForThread: vi.fn(async () => []),
    clearResolved: vi.fn(async () => ({ removed: [] })),
  } as unknown as Rpc;
}

function props(overrides: Partial<ExperimentalPluginBrowserToolbarActionProps> = {}) {
  return {
    threadId: "thr",
    tabId: "tab",
    url: "https://example.com/a",
    isCompactViewport: false,
    experimental_page: fakePage(),
    ...overrides,
  } as ExperimentalPluginBrowserToolbarActionProps;
}

describe("plugin registration", () => {
  it("adds one Browser toolbar control and one headless overlay", () => {
    expect(app.browserToolbarActions.map((action) => action.id)).toEqual(["annotate"]);
    expect(app.appOverlays.map((overlay) => overlay.id)).toEqual(["pill-sync"]);
  });
});

describe("Annotate control", () => {
  it("is not shown without page script access", () => {
    const view = renderSlot(toolbar, props({ experimental_page: null }), { rpc: rpc() });

    expect(view.queryByRole("button")).toBeNull();
  });

  it("toggles annotate mode in the page", async () => {
    const page = fakePage();
    const view = renderSlot(toolbar, props({ experimental_page: page }), { rpc: rpc() });
    const button = view.getByRole("button", { name: "Annotate page" });

    fireEvent.click(button);

    expect(button.getAttribute("aria-pressed")).toBe("true");
    await waitFor(() =>
      expect(
        page.evaluate.mock.calls.some(([script]) => script.includes("await api.setMode(true)")),
      ).toBe(true),
    );
    fireEvent.click(button);
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });

  it("turns annotate mode off with Esc while the control has focus", () => {
    const view = renderSlot(toolbar, props(), { rpc: rpc() });
    const button = view.getByRole("button", { name: "Annotate page" });
    fireEvent.click(button);

    fireEvent.keyDown(button, { key: "Escape" });

    expect(button.getAttribute("aria-pressed")).toBe("false");
  });

  it("keeps one controller across host re-renders", async () => {
    const page = fakePage();
    const view = renderSlot(toolbar, props({ experimental_page: page }), { rpc: rpc() });
    await waitFor(() => expect(page.onMessage).toHaveBeenCalledTimes(1));

    const Toolbar = toolbar.component;
    act(() => view.lifecycle.rerender(<Toolbar {...props({ experimental_page: page })} />));
    act(() => view.lifecycle.rerender(<Toolbar {...props({ experimental_page: page })} />));

    expect(page.onMessage).toHaveBeenCalledTimes(1);
    expect(
      page.evaluate.mock.calls.some(([script]) => script.includes("await api.teardown(")),
    ).toBe(false);
  });

  it("loads the pins of the new page when the URL changes", async () => {
    const handlers = rpc();
    const page = fakePage();
    const view = renderSlot(toolbar, props({ experimental_page: page }), { rpc: handlers });
    await waitFor(() =>
      expect(handlers.listForUrl).toHaveBeenCalledWith({
        threadId: "thr",
        url: "https://example.com/a",
      }),
    );

    const Toolbar = toolbar.component;
    act(() =>
      view.lifecycle.rerender(
        <Toolbar {...props({ experimental_page: page, url: "https://example.com/b" })} />,
      ),
    );

    await waitFor(() =>
      expect(handlers.listForUrl).toHaveBeenCalledWith({
        threadId: "thr",
        url: "https://example.com/b",
      }),
    );
  });

  it("reloads pins when another surface changes the thread's annotations", async () => {
    const handlers = rpc();
    const view = renderSlot(toolbar, props(), { rpc: handlers });
    await waitFor(() => expect(handlers.listForUrl).toHaveBeenCalledTimes(1));

    await view.behavior.emitRealtime("annotations:changed", { threadId: "other" });
    await view.behavior.emitRealtime("annotations:changed", { threadId: "thr" });

    await waitFor(() => expect(handlers.listForUrl).toHaveBeenCalledTimes(2));
  });
});
