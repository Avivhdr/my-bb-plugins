import { describe, expect, it } from "vitest";
import { readNotFoundPartial } from "./not-found-partial";

const notFound = (path: string[]) => ({ type: "NOT_FOUND", path, message: "Could not resolve" });

describe("readNotFoundPartial", () => {
  it("returns the response when every error is NOT_FOUND", () => {
    const response = {
      data: { reviewRequests: { issueCount: 0, nodes: [] }, t0: null, t1: { pullRequest: null } },
      errors: [notFound(["t0"]), notFound(["t1", "pullRequest"])],
    };

    expect(readNotFoundPartial(JSON.stringify(response))).toEqual(response);
  });

  it("refuses a response with another error type", () => {
    const response = {
      data: { t0: null },
      errors: [notFound(["t0"]), { type: "FORBIDDEN", message: "no" }],
    };

    expect(readNotFoundPartial(JSON.stringify(response))).toBeNull();
  });

  it("refuses a response without data", () => {
    expect(readNotFoundPartial(JSON.stringify({ errors: [notFound(["t0"])] }))).toBeNull();
  });

  it("refuses a response without errors", () => {
    expect(readNotFoundPartial(JSON.stringify({ data: {} }))).toBeNull();
  });

  it("refuses output that is not JSON", () => {
    expect(readNotFoundPartial("")).toBeNull();
    expect(readNotFoundPartial("gh: HTTP 502")).toBeNull();
  });
});
