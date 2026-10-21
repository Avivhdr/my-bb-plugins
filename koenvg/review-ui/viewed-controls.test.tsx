// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { CollapseButton, ViewedCheckbox } from "./viewed-controls";

afterEach(cleanup);

const ICONS = { collapsed: <span>closed</span>, expanded: <span>open</span> };

it("labels the collapse button by the action it takes", () => {
  const onToggle = vi.fn();
  const view = render(
    <CollapseButton path="a.ts" collapsed={false} onToggle={onToggle} icons={ICONS} />,
  );

  const button = view.getByRole("button", { name: "Collapse a.ts" });
  fireEvent.click(button);

  expect(button.getAttribute("aria-expanded")).toBe("true");
  expect(button.textContent).toBe("open");
  expect(onToggle).toHaveBeenCalledOnce();
});

it("shows the collapsed icon and the expand label when collapsed", () => {
  const view = render(<CollapseButton path="a.ts" collapsed onToggle={vi.fn()} icons={ICONS} />);

  const button = view.getByRole("button", { name: "Expand a.ts" });

  expect(button.getAttribute("aria-expanded")).toBe("false");
  expect(button.textContent).toBe("closed");
});

it("toggles the viewed checkbox", () => {
  const onToggle = vi.fn();
  const view = render(
    <ViewedCheckbox path="a.ts" checked={false} disabled={false} onToggle={onToggle} />,
  );

  fireEvent.click(view.getByRole("checkbox", { name: "Viewed a.ts" }));

  expect(onToggle).toHaveBeenCalledOnce();
});

it("disables the viewed checkbox", () => {
  const view = render(<ViewedCheckbox path="a.ts" checked disabled onToggle={vi.fn()} />);

  const checkbox = view.getByRole("checkbox", { name: "Viewed a.ts" }) as HTMLInputElement;

  expect(checkbox.checked).toBe(true);
  expect(checkbox.disabled).toBe(true);
});
