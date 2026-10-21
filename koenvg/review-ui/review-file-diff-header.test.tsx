// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { parsePatchFiles } from "@pierre/diffs";
import { ReviewFileDiff } from "./review-file-diff";
import { CollapseButton, ViewedCheckbox } from "./viewed-controls";

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(cleanup);

const fileDiff = parsePatchFiles(
  "diff --git a/old.ts b/new.ts\nsimilarity index 90%\nrename from old.ts\nrename to new.ts\n--- a/old.ts\n+++ b/new.ts\n@@ -1 +1 @@\n-a\n+b\n",
)[0]!.files[0]!;

function Review({ controls = true, disabled = false }: { controls?: boolean; disabled?: boolean }) {
  const [collapsed, setCollapsed] = useState(false);
  const [viewed, setViewed] = useState(false);
  const toggleCollapsed = () => setCollapsed((value) => !value);
  return (
    <ReviewFileDiff
      fileDiff={fileDiff}
      annotations={[]}
      renderAnnotation={() => null}
      view="split"
      theme={{ name: "github-light", mode: "light" }}
      collapsed={collapsed}
      onToggleCollapsed={controls ? toggleCollapsed : undefined}
      headerPrefix={
        controls && (
          <CollapseButton
            path="new.ts"
            collapsed={collapsed}
            onToggle={toggleCollapsed}
            icons={{ collapsed: ">", expanded: "v" }}
          />
        )
      }
      headerMetadata={
        controls && (
          <ViewedCheckbox
            path="new.ts"
            checked={viewed}
            disabled={disabled}
            onToggle={() => setViewed((value) => !value)}
          />
        )
      }
    />
  );
}

async function header(container: HTMLElement) {
  return waitFor(() => {
    const root = container.querySelector("diffs-container")?.shadowRoot;
    expect(root?.querySelector("[data-title]")?.textContent).toBe("new.ts");
    return root!;
  });
}

it.each(["data-title", "data-prev-name"])(
  "toggles from %s and keeps Viewed unchanged",
  async (attribute) => {
    const view = render(<Review />);
    const root = await header(view.container);
    const filename = root.querySelector<HTMLElement>(`[${attribute}]`)!;
    expect(filename.getAttribute("role")).toBe("button");
    expect(filename.tabIndex).toBe(0);
    expect(filename.getAttribute("aria-expanded")).toBe("true");
    expect(root.querySelector("pre")).not.toBeNull();

    fireEvent.click(filename.querySelector("bdi")!);
    expect(view.getByRole("button", { name: "Expand new.ts" }).getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(filename.getAttribute("aria-expanded")).toBe("false");
    expect(root.querySelector("pre")).toBeNull();
    expect(
      (view.getByRole("checkbox", { name: "Viewed new.ts" }) as HTMLInputElement).checked,
    ).toBe(false);

    fireEvent.click(filename);
    expect(
      view.getByRole("button", { name: "Collapse new.ts" }).getAttribute("aria-expanded"),
    ).toBe("true");
    expect(filename.getAttribute("aria-expanded")).toBe("true");
    expect(root.querySelector("pre")).not.toBeNull();
  },
);

it.each(["Enter", " "])("toggles a focused filename with %s", async (key) => {
  const view = render(<Review />);
  const root = await header(view.container);
  const filename = root.querySelector<HTMLElement>("[data-title]")!;
  filename.focus();
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  fireEvent(filename, event);
  expect(event.defaultPrevented).toBe(true);
  expect(view.getByRole("button", { name: "Expand new.ts" }).getAttribute("aria-expanded")).toBe(
    "false",
  );

  fireEvent.keyDown(filename, { key, repeat: true });
  fireEvent.keyDown(filename, { key: "ArrowDown" });
  expect(filename.getAttribute("aria-expanded")).toBe("false");
});

it("replaces handlers on repeated renders and keeps chevron and Viewed independent", async () => {
  const view = render(<Review />);
  const root = await header(view.container);
  view.rerender(<Review />);
  view.rerender(<Review />);

  fireEvent.click(root.querySelector("[data-title]")!);
  expect(view.getByRole("button", { name: "Expand new.ts" }).getAttribute("aria-expanded")).toBe(
    "false",
  );
  fireEvent.click(view.getByRole("button", { name: "Expand new.ts" }));
  expect(root.querySelector("[data-title]")!.getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(view.getByText("Viewed"));
  expect((view.getByRole("checkbox", { name: "Viewed new.ts" }) as HTMLInputElement).checked).toBe(
    true,
  );
  expect(root.querySelector("[data-title]")!.getAttribute("aria-expanded")).toBe("true");

  view.rerender(<Review disabled />);
  fireEvent.click(view.getByText("Viewed"));
  expect((view.getByRole("checkbox", { name: "Viewed new.ts" }) as HTMLInputElement).checked).toBe(
    true,
  );
  expect(root.querySelector("[data-title]")!.getAttribute("aria-expanded")).toBe("true");
});

it("keeps filenames inert without collapse controls, including after removing controls", async () => {
  const view = render(<Review controls={false} />);
  const root = await header(view.container);
  const filename = root.querySelector<HTMLElement>("[data-title]")!;
  expect(filename.getAttribute("role")).toBeNull();
  expect(filename.getAttribute("aria-expanded")).toBeNull();

  view.rerender(<Review />);
  expect(filename.getAttribute("aria-expanded")).toBe("true");
  view.rerender(<Review controls={false} />);
  fireEvent.click(filename);
  fireEvent.keyDown(filename, { key: "Enter" });
  expect(filename.getAttribute("role")).toBeNull();
  expect(filename.getAttribute("tabindex")).toBeNull();
  expect(filename.getAttribute("aria-expanded")).toBeNull();
  expect(root.querySelector("pre")).not.toBeNull();
});
