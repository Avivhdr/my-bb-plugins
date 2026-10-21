// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { InlineCommentForm } from "./inline-comment-form";

afterEach(cleanup);

function renderForm(text: string) {
  const handlers = { onTextChange: vi.fn(), onSubmit: vi.fn(), onCancel: vi.fn() };
  const view = render(<InlineCommentForm text={text} {...handlers} />);
  return { ...view, ...handlers, box: view.getByRole("textbox", { name: "Comment" }) };
}

describe("InlineCommentForm", () => {
  it("reports typed text", () => {
    const form = renderForm("");

    fireEvent.change(form.box, { target: { value: "hi" } });

    expect(form.onTextChange).toHaveBeenCalledWith("hi");
  });

  it("submits on the button and on Cmd or Ctrl+Enter", () => {
    const form = renderForm("Typo");

    fireEvent.click(form.getByRole("button", { name: "Add to review" }));
    fireEvent.keyDown(form.box, { key: "Enter", metaKey: true });
    fireEvent.keyDown(form.box, { key: "Enter", ctrlKey: true });

    expect(form.onSubmit).toHaveBeenCalledTimes(3);
  });

  it("does not submit blank text", () => {
    const form = renderForm("  \n ");

    fireEvent.keyDown(form.box, { key: "Enter", metaKey: true });

    expect(
      (form.getByRole("button", { name: "Add to review" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(form.onSubmit).not.toHaveBeenCalled();
  });

  it("cancels on Escape and on the Cancel button", () => {
    const form = renderForm("x");

    fireEvent.keyDown(form.box, { key: "Escape" });
    fireEvent.click(form.getByRole("button", { name: "Cancel" }));

    expect(form.onCancel).toHaveBeenCalledTimes(2);
  });
});

it("focuses the text box after it mounts", async () => {
  const view = render(
    <InlineCommentForm text="" onTextChange={() => {}} onSubmit={() => {}} onCancel={() => {}} />,
  );

  await new Promise((resolve) => requestAnimationFrame(resolve));

  expect(document.activeElement).toBe(view.getByRole("textbox", { name: "Comment" }));
});
