// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ActionMenu } from "./action-menu";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function openWithTriggerAt(top: number, bottom: number, innerHeight = 1000) {
  vi.stubGlobal("innerHeight", innerHeight);
  vi.stubGlobal("innerWidth", 400);
  render(<ActionMenu label="Actions" items={[{ label: "Pin", run: () => {} }]} />);
  const trigger = screen.getByRole("button", { name: "Actions" });
  vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
    top,
    bottom,
    left: 360,
    right: 384,
    width: 24,
    height: bottom - top,
    x: 360,
    y: top,
    toJSON: () => ({}),
  });
  fireEvent.click(trigger);
  return screen.getByRole("menu").style;
}

describe("ActionMenu", () => {
  it("opens below a trigger with room under it", () => {
    const style = openWithTriggerAt(100, 124);
    expect(style.top).toBe("128px");
    expect(style.bottom).toBe("");
    expect(style.maxHeight).toBe("864px");
  });

  it("opens above a trigger near the bottom of the window instead of jumping to the top", () => {
    const style = openWithTriggerAt(760, 784);
    expect(style.top).toBe("");
    expect(style.bottom).toBe("244px");
    expect(style.maxHeight).toBe("748px");
  });

  it("opens below when neither side has full room but below has more", () => {
    const style = openWithTriggerAt(130, 154, 300);
    expect(style.top).toBe("158px");
    expect(style.maxHeight).toBe("134px");
  });
});
