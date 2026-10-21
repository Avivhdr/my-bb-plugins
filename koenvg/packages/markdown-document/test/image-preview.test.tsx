// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  MarkdownDocument,
  createDocumentModel,
  type DestinationPolicy,
} from "@bb-plugins/markdown-document";

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const model = createDocumentModel('![Chart](chart.png "Trend")', "viewer");
const policy: DestinationPolicy = {
  kind: "delegated",
  resolve: () => ({ kind: "image", url: "/approved/chart.png", source: "source" }),
};
function open() {
  const trigger = screen.getByRole("button", { name: "Enlarge image: Chart" });
  fireEvent.load(within(trigger).getByRole("img"));
  fireEvent.click(trigger);
  return screen.getByRole("dialog", { name: "Image preview: Chart" });
}
it("enlarges only a ready authorized image using its exact borrowed source and attributes", () => {
  const { unmount } = render(
    <MarkdownDocument model={model} view="preview" destinations={policy} />,
  );
  const trigger = screen.getByRole("button", { name: "Enlarge image: Chart" }) as HTMLButtonElement;
  expect(trigger.disabled).toBe(true);
  fireEvent.click(trigger);
  expect(screen.queryByRole("dialog")).toBeNull();
  const dialog = open();
  expect(dialog.closest(".md-document")).not.toBeNull();
  expect(dialog.closest(".mr-prose")).toBeNull();
  const image = within(dialog).getByRole("img");
  expect(image.getAttribute("src")).toBe("/approved/chart.png");
  expect(image.getAttribute("referrerpolicy")).toBe("no-referrer");
  expect(image.getAttribute("crossorigin")).toBeNull();
  fireEvent.click(within(dialog).getByRole("button", { name: "Close image preview" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(trigger);
  expect(screen.getByRole("dialog")).toBeTruthy();
  unmount();
  expect(document.querySelector("dialog[open]")).toBeNull();
});
it.each(["raw", "model", "policy", "source", "deny"])(
  "invalidates an open session on %s replacement",
  (change) => {
    let url = "/approved/chart.png";
    const mutable: DestinationPolicy = {
      kind: "delegated",
      resolve: () => ({ kind: "image", url, source: "source" }),
    };
    const { rerender } = render(
      <MarkdownDocument model={model} view="preview" destinations={mutable} />,
    );
    open();
    if (change === "source") url = "/approved/new.png";
    rerender(
      <MarkdownDocument
        model={
          change === "model" ? createDocumentModel('![Chart](chart.png "Trend")', "viewer") : model
        }
        view={change === "raw" ? "raw" : "preview"}
        destinations={
          change === "deny"
            ? { kind: "deny" }
            : change === "policy" || change === "source"
              ? { ...mutable }
              : mutable
        }
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  },
);
it("separates reference, mixed and multiple image links from navigation without nested controls", () => {
  const links = createDocumentModel(
    '[![Chart](chart.png)][guide] [mixed ![Chart](chart.png) ![Second](second.png)](https://example.com) [text](https://example.com)\n\n[guide]: https://example.com "Guide"',
    "links",
  );
  const resolve: DestinationPolicy = {
    kind: "delegated",
    resolve: (request) =>
      request.image
        ? { kind: "image", url: "/approved/chart.png", source: "source" }
        : { kind: "bound-link", render: (props) => <a href="https://example.com" {...props} /> },
  };
  render(<MarkdownDocument model={links} view="preview" destinations={resolve} />);
  expect(document.querySelector("a button, button a")).toBeNull();
  expect(screen.getAllByRole("button", { name: "Enlarge image: Chart" })).toHaveLength(2);
  expect(
    screen.getByRole("link", { name: "Open linked destination: Chart" }).getAttribute("title"),
  ).toBe("Guide");
  expect(
    screen
      .getByRole("link", { name: "Open linked destination: mixed Chart Second" })
      .getAttribute("href"),
  ).toBe("https://example.com");
  expect(screen.getByRole("link", { name: "text" })).toBeTruthy();
});
it("reuses the owned blob across reopen and closes synchronously before error release", async () => {
  const fetch = vi.fn(
    async () => new Response(new Uint8Array([1]), { headers: { "content-type": "image/png" } }),
  );
  vi.stubGlobal("fetch", fetch);
  const create = vi.fn(() => "blob:borrowed");
  const revoke = vi.fn(() => expect(document.querySelector("dialog[open]")).toBeNull());
  vi.spyOn(URL, "createObjectURL").mockImplementation(create);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(revoke);
  const remote = createDocumentModel("![Chart](https://images.example/chart.png)", "blob");
  const allowed: DestinationPolicy = { kind: "attachment", remoteImages: true };
  const { unmount } = render(
    <MarkdownDocument model={remote} view="preview" destinations={allowed} />,
  );
  await waitFor(() =>
    expect(screen.getByRole("img", { name: "Chart" }).getAttribute("src")).toBe("blob:borrowed"),
  );
  const dialog = open();
  expect(within(dialog).getByRole("img").getAttribute("src")).toBe("blob:borrowed");
  fireEvent.click(within(dialog).getByRole("button"));
  expect(revoke).not.toHaveBeenCalled();
  open();
  fireEvent.error(screen.getAllByRole("img", { name: "Chart" })[0]!);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(create).toHaveBeenCalledTimes(1);
  unmount();
  expect(revoke).toHaveBeenCalledTimes(1);
});
it("uses anonymous CORS for delegated remote previews and keeps preview failures readable", () => {
  const remote = createDocumentModel("![Chart](https://images.example/chart.png)", "remote");
  const resolve: DestinationPolicy = {
    kind: "delegated",
    resolve: () => ({ kind: "image", url: "https://images.example/chart.png", source: "remote" }),
  };
  render(<MarkdownDocument model={remote} view="preview" destinations={resolve} />);
  const inline = screen.getByRole("img", { name: "Chart" });
  expect(inline.getAttribute("crossorigin")).toBe("anonymous");
  const dialog = open();
  const enlarged = within(dialog).getByRole("img");
  expect(enlarged.getAttribute("src")).toBe("https://images.example/chart.png");
  expect(enlarged.getAttribute("crossorigin")).toBe("anonymous");
  expect(enlarged.getAttribute("referrerpolicy")).toBe("no-referrer");
  fireEvent.error(enlarged);
  expect(within(dialog).getByRole("status").textContent).toBe(
    "Image preview unavailable. Close and reopen to retry.",
  );
  fireEvent.click(within(dialog).getByRole("button"));
  expect(inline.getAttribute("src")).toBe("https://images.example/chart.png");
  fireEvent.error(inline);
  expect(screen.getByText("Image unavailable. Refresh to retry.").textContent).toBe(
    " Image unavailable. Refresh to retry.",
  );
  expect(screen.queryByRole("button", { name: "Enlarge image: Chart" })).toBeNull();
});
it("recognizes cached decoded images without waiting for another load event", async () => {
  vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
  vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(30);
  const decode = vi.fn(async () => {});
  Object.defineProperty(HTMLImageElement.prototype, "decode", {
    configurable: true,
    value: decode,
  });
  try {
    render(<MarkdownDocument model={model} view="preview" destinations={policy} />);
    const trigger = screen.getByRole("button", {
      name: "Enlarge image: Chart",
    }) as HTMLButtonElement;
    await waitFor(() => expect(trigger.disabled).toBe(false));
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("Image preview: Chart");
    expect(decode).toHaveBeenCalledTimes(1);
  } finally {
    Reflect.deleteProperty(HTMLImageElement.prototype, "decode");
  }
});
it("keeps denied and pending images inert, including image-bearing denied links", async () => {
  const denied = createDocumentModel("[![Chart](chart.png)](next.md)", "denied");
  const { rerender } = render(<MarkdownDocument model={denied} view="preview" />);
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.getByText("Open linked destination: Chart").tagName).toBe("SPAN");
  expect(document.querySelector("a button, button a")).toBeNull();
  const pending = createDocumentModel("![Chart](https://images.example/chart.png)", "pending");
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => {})),
  );
  rerender(
    <MarkdownDocument
      model={pending}
      view="preview"
      destinations={{ kind: "attachment", remoteImages: true }}
    />,
  );
  expect(screen.getByRole("img", { name: "Chart" }).textContent).toBe("Chart");
  expect(screen.queryByRole("button")).toBeNull();
});
it("closes on equivalent policy churn without releasing or reloading the inline blob", async () => {
  const fetch = vi.fn(
    async () => new Response(new Uint8Array([1]), { headers: { "content-type": "image/png" } }),
  );
  vi.stubGlobal("fetch", fetch);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:retained");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const remote = createDocumentModel("![Chart](https://images.example/chart.png)", "retained");
  const component = () => (
    <MarkdownDocument
      model={remote}
      view="preview"
      destinations={{ kind: "attachment", remoteImages: true }}
    />
  );
  const { rerender, unmount } = render(component());
  await waitFor(() =>
    expect(screen.getByRole("img", { name: "Chart" }).getAttribute("src")).toBe("blob:retained"),
  );
  open();
  rerender(component());
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("img", { name: "Chart" }).getAttribute("src")).toBe("blob:retained");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(revoke).toHaveBeenCalledTimes(0);
  unmount();
  expect(revoke.mock.calls).toEqual([["blob:retained"]]);
});
