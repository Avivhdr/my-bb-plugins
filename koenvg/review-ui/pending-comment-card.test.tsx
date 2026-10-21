// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { PendingCommentCard } from "./pending-comment-card";

afterEach(cleanup);

it("shows the body and location, and removes on click", () => {
  const onRemove = vi.fn();
  const view = render(
    <PendingCommentCard
      body={"line one\nline two"}
      location={<span>a.ts:2</span>}
      onRemove={onRemove}
    />,
  );

  fireEvent.click(view.getByRole("button", { name: "Remove" }));

  expect(view.getByRole("article", { name: "Pending comment" }).textContent).toContain("a.ts:2");
  expect(view.getByText(/line one/).textContent).toBe("line one\nline two");
  expect(onRemove).toHaveBeenCalledOnce();
});
