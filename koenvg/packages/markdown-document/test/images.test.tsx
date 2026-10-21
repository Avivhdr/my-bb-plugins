// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { type DestinationPolicy } from "@bb-plugins/markdown-document";
import { ModelDocument as MarkdownDocument } from "./consumer.js";

const policy: DestinationPolicy = { kind: "attachment", remoteImages: true };
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function blobs() {
  let next = 0;
  const create = vi.fn(() => `blob:owned-${++next}`);
  const revoke = vi.fn();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    },
  );
  return { create, revoke };
}
function image(bytes = new Uint8Array([1, 2, 3])) {
  return new Response(bytes, { headers: { "content-type": "image/png" } });
}
it("fetches explicit remote permission without credentials, referrer or redirects and owns blob cleanup", async () => {
  const { create, revoke } = blobs();
  const fetch = vi.fn(async (_url: string, _options: RequestInit) => image());
  vi.stubGlobal("fetch", fetch);
  const text = `![allowed](https://images.example/chart.png) ![same](${location.origin}/api/private) ![relative](./chart.png)`;
  const { rerender, unmount } = render(
    <MarkdownDocument namespace="images" view="preview" destinations={policy} text={text} />,
  );
  await waitFor(() =>
    expect(screen.getByRole("img", { name: "allowed" }).getAttribute("src")).toBe("blob:owned-1"),
  );
  expect(fetch.mock.calls.map((call) => call[0])).toEqual(["https://images.example/chart.png"]);
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({
    mode: "cors",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    redirect: "error",
  });
  expect(screen.getByRole("img", { name: "same" }).textContent).toBe("same (image unavailable)");
  expect(screen.getByRole("img", { name: "relative" }).textContent).toBe("relative");
  expect(create.mock.calls.length).toBe(1);
  rerender(<MarkdownDocument namespace="images" view="raw" destinations={policy} text={text} />);
  expect(screen.getByLabelText("Raw Markdown").textContent).toBe(text);
  expect(revoke.mock.calls).toEqual([["blob:owned-1"]]);
  rerender(
    <MarkdownDocument
      namespace="images"
      view="preview"
      destinations={policy}
      text="![next](https://images.example/next.png)"
    />,
  );
  await waitFor(() =>
    expect(screen.getByRole("img", { name: "next" }).getAttribute("src")).toBe("blob:owned-2"),
  );
  fireEvent.error(screen.getByRole("img", { name: "next" }));
  expect(screen.getByRole("img", { name: "next" }).textContent).toBe("next (image unavailable)");
  unmount();
  expect(revoke.mock.calls).toEqual([["blob:owned-1"], ["blob:owned-2"]]);
});
it("aborts replacement and unmount and never displays a late fetched image", async () => {
  const { create } = blobs();
  const requests: { resolve: (response: Response) => void; signal: AbortSignal }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url, options) =>
        new Promise<Response>((resolve) => requests.push({ resolve, signal: options.signal })),
    ),
  );
  const { rerender, unmount } = render(
    <MarkdownDocument
      namespace="replace"
      view="preview"
      destinations={policy}
      text="![old](https://images.example/old.png)"
    />,
  );
  await waitFor(() => expect(requests.length).toBe(1));
  rerender(
    <MarkdownDocument
      namespace="replace"
      view="preview"
      destinations={policy}
      text="![new](https://images.example/new.png)"
    />,
  );
  await waitFor(() => expect(requests.length).toBe(2));
  expect(requests[0]!.signal.aborted).toBe(true);
  await act(async () => requests[0]!.resolve(image()));
  expect(screen.getByRole("img", { name: "new" }).textContent).toBe("new");
  expect(create.mock.calls).toEqual([]);
  unmount();
  expect(requests[1]!.signal.aborted).toBe(true);
});
it("bounds concurrency and total requests while keeping rejected image labels", async () => {
  blobs();
  const requests: { resolve: (response: Response) => void }[] = [];
  const fetch = vi.fn(() => new Promise<Response>((resolve) => requests.push({ resolve })));
  vi.stubGlobal("fetch", fetch);
  render(
    <MarkdownDocument
      namespace="bounded"
      view="preview"
      destinations={policy}
      text={Array.from(
        { length: 34 },
        (_, index) => `![image${index}](https://images.example/${index}.png)`,
      ).join(" ")}
    />,
  );
  await waitFor(() => expect(requests.length).toBe(4));
  expect(screen.getByRole("img", { name: "image33" }).textContent).toBe(
    "image33 (image unavailable)",
  );
  for (let batch = 0; batch < 8; batch++) {
    await act(async () => {
      for (const request of requests.slice(batch * 4, batch * 4 + 4)) request.resolve(image());
    });
    await waitFor(() => expect(requests.length).toBe(Math.min((batch + 2) * 4, 32)));
  }
  expect(fetch.mock.calls.length).toBe(32);
  expect(screen.getByRole("img", { name: "image31" }).getAttribute("src")).toBe("blob:owned-32");
});
it("keeps image ownership and the request budget across equivalent inline policies", async () => {
  const { create, revoke } = blobs();
  const fetch = vi.fn(async () => image());
  vi.stubGlobal("fetch", fetch);
  const text = Array.from(
    { length: 34 },
    (_, index) => `![image${index}](https://images.example/${index}.png)`,
  ).join(" ");
  const component = () => (
    <MarkdownDocument
      namespace="rerender-budget"
      view="preview"
      text={text}
      destinations={{ kind: "attachment", remoteImages: true, openExternal: () => true }}
    />
  );
  const { rerender } = render(component());
  await waitFor(() =>
    expect(screen.getByRole("img", { name: "image31" }).getAttribute("src")).toBe("blob:owned-32"),
  );
  for (let count = 0; count < 33; count++) {
    rerender(component());
    await act(async () => {});
  }
  expect(fetch.mock.calls.length).toBe(32);
  expect(create.mock.calls.length).toBe(32);
  expect(revoke.mock.calls).toEqual([]);
  expect(screen.getByRole("img", { name: "image0" }).getAttribute("src")).toBe("blob:owned-1");
  expect(screen.getByRole("img", { name: "image33" }).textContent).toBe(
    "image33 (image unavailable)",
  );
});
it("enforces streamed per-image and aggregate limits without Content-Length and has readable CORS failures", async () => {
  const { create } = blobs();
  let cancelled = false;
  const fetch = vi.fn(async (url: string) => {
    if (url.includes("cors")) throw new TypeError("CORS failure");
    if (url.includes("oversize"))
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(4 * 1024 * 1024));
            controller.enqueue(new Uint8Array([1]));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { "content-type": "image/png" } },
      );
    return image(new Uint8Array(4 * 1024 * 1024));
  });
  vi.stubGlobal("fetch", fetch);
  render(
    <MarkdownDocument
      namespace="bytes"
      view="preview"
      destinations={policy}
      text="![large](https://images.example/oversize) ![cors](https://images.example/cors)"
    />,
  );
  await waitFor(() =>
    expect(screen.getByRole("img", { name: "large" }).textContent).toBe(
      "large (image unavailable)",
    ),
  );
  expect(screen.getByRole("img", { name: "cors" }).textContent).toBe("cors (image unavailable)");
  expect(cancelled).toBe(true);
  expect(create.mock.calls).toEqual([]);
  cleanup();
  render(
    <MarkdownDocument
      namespace="aggregate"
      view="preview"
      destinations={policy}
      text={Array.from(
        { length: 5 },
        (_, index) => `![asset${index}](https://images.example/${index})`,
      ).join(" ")}
    />,
  );
  await waitFor(() =>
    expect(screen.getByRole("img", { name: "asset4" }).textContent).toBe(
      "asset4 (image unavailable)",
    ),
  );
  expect(create.mock.calls.length).toBe(4);
  expect(screen.getByRole("img", { name: "asset0" }).getAttribute("src")).toBe("blob:owned-1");
});
