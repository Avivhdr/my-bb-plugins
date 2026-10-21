// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FixtureMarkdown } from "./preview/markdown";

afterEach(cleanup);
describe("isolated preview renderer", () => {
  it("renders Markdown headings, lists, and literal code without interpreting shell source", () => {
    const view = render(
      <FixtureMarkdown content={'# Guidance\n\n- One\n- Two\n\n```sh\n$(echo "$HOME")\n```'} />,
    );
    expect(screen.getByRole("heading", { name: "Guidance" })).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(view.container.querySelector("code")?.textContent).toBe('$(echo "$HOME")\n');
  });
  it("does not execute HTML, unsafe links, or image requests", () => {
    const view = render(
      <FixtureMarkdown
        content={
          '<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[unsafe](javascript:alert%281%29)\n\n![remote](https://example.com/pixel)'
        }
      />,
    );
    expect(view.container.querySelector("script, img, iframe")).toBeNull();
    expect(screen.getByText("unsafe").getAttribute("href")).not.toMatch(/^javascript:/);
    expect(screen.getByText("[Image: remote]")).toBeTruthy();
  });
});
