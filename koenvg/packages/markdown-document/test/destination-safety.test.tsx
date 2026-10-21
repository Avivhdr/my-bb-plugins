// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDocumentModel,
  MarkdownDocument,
  type DestinationPolicy,
} from "@bb-plugins/markdown-document";

afterEach(cleanup);

type DispatchPolicy = "attachment" | "bound-source" | "delegated";
function policyFixture(kind: DispatchPolicy) {
  const open = vi.fn(() => true);
  const activate = vi.fn(() => true);
  const resolve = vi.fn((request: { url: string }) => ({
    kind: "bound-link" as const,
    render: (props: React.ComponentProps<"a">) => <a {...props} href={request.url} />,
  }));
  const permissions = { localFragments: true, openExternal: open };
  const policy: DestinationPolicy =
    kind === "delegated"
      ? { kind, resolve }
      : kind === "attachment"
        ? { kind, ...permissions }
        : {
            kind,
            ...permissions,
            binding: {
              root: "/root",
              host: "fixture-host",
              documentPath: "/root/reports/current.md",
            },
            activateSource: activate,
          };
  return { policy, open, activate, resolve };
}

describe.each(["attachment", "bound-source", "delegated"] as const)("%s safety gate", (kind) => {
  it("keeps rejected encodings readable without active links or dispatch", () => {
    const urls = [
      "%2e%2e/notes.md",
      "https://example.org/a%2fb",
      "https://example.org/a%252fb",
      "https://example.org/%2e%2e/notes.md",
    ];
    const model = createDocumentModel(
      urls.map((url, index) => `[rejected${index}](${url})`).join("\n\n"),
      "rejected",
    );
    const { policy, open, activate, resolve } = policyFixture(kind);
    const { container } = render(
      <MarkdownDocument model={model} view="preview" destinations={policy} />,
    );
    expect(model.requests).toEqual([]);
    expect(container.querySelectorAll("a").length).toBe(0);
    for (const [index] of urls.entries()) {
      const label = screen.getByText(`rejected${index}`);
      expect(label.tagName).toBe("SPAN");
      fireEvent.click(label);
    }
    expect(open).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });

  it("bounds external links while preserving local navigation after the request budget", () => {
    const model = createDocumentModel(
      "# Target\n\n" +
        Array.from(
          { length: 140 },
          (_, index) => `[link${index}](https://example.org/note${index})`,
        ).join("\n\n") +
        "\n\n[local](#target)",
      "external-budget",
    );
    const { policy, open, activate, resolve } = policyFixture(kind);
    const { container } = render(
      <MarkdownDocument model={model} view="preview" destinations={policy} />,
    );
    expect(model.requests.length).toBe(128);
    expect(container.querySelectorAll("a").length).toBe(129);
    expect(screen.getByRole("link", { name: "link127" }).getAttribute("href")).toBe(
      "https://example.org/note127",
    );
    for (let index = 128; index < 140; index++) {
      const label = screen.getByText(`link${index}`);
      expect(label.tagName).toBe("SPAN");
      fireEvent.click(label);
    }
    expect(screen.getByRole("link", { name: "local" }).getAttribute("href")).toMatch(/^#/);
    expect(open).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
    expect(resolve).toHaveBeenCalledTimes(kind === "delegated" ? 128 : 0);
  });
});

it("bounds source links without losing a legitimate confined activation", () => {
  const model = createDocumentModel(
    Array.from({ length: 140 }, (_, index) => `[source${index}](note${index}.md)`).join("\n\n"),
    "source-budget",
  );
  const { policy, activate, open } = policyFixture("bound-source");
  const { container } = render(
    <MarkdownDocument model={model} view="preview" destinations={policy} />,
  );
  expect(model.requests.length).toBe(128);
  expect(container.querySelectorAll("a").length).toBe(128);
  for (let index = 128; index < 140; index++) {
    const label = screen.getByText(`source${index}`);
    expect(label.tagName).toBe("SPAN");
    fireEvent.click(label);
  }
  expect(activate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("link", { name: "source127" }));
  expect(activate.mock.calls).toEqual([
    [{ host: "fixture-host", path: "/root/reports/note127.md" }],
  ]);
  expect(open).not.toHaveBeenCalled();
});
