import { describe, expect, it } from "vitest";
import { submitRules, type SubmitRulesInput } from "./review-submit";

const otherPr: SubmitRulesInput = {
  viewerIsAuthor: false,
  state: "OPEN",
  body: "Summary",
  commentCount: 0,
};

describe("submitRules", () => {
  it.each<[string, Partial<SubmitRulesInput>, Record<string, string | null>]>([
    ["another person's PR", {}, { COMMENT: null, APPROVE: null, REQUEST_CHANGES: null }],
    ["the viewer's own PR", { viewerIsAuthor: true }, { COMMENT: null }],
    [
      "an empty body",
      { body: "" },
      {
        COMMENT: "Add a summary or a comment",
        APPROVE: null,
        REQUEST_CHANGES: "Add a summary to request changes",
      },
    ],
    [
      "a blank body with 2 comment drafts",
      { body: "  \n", commentCount: 2 },
      { COMMENT: null, APPROVE: null, REQUEST_CHANGES: "Add a summary to request changes" },
    ],
    [
      "an empty body on the viewer's own PR",
      { viewerIsAuthor: true, body: "" },
      { COMMENT: "Add a summary or a comment" },
    ],
    [
      "a merged PR",
      { state: "MERGED" },
      {
        COMMENT: "Pull request is merged",
        APPROVE: "Pull request is merged",
        REQUEST_CHANGES: "Pull request is merged",
      },
    ],
    [
      "a closed PR with an empty body",
      { state: "CLOSED", body: "" },
      {
        COMMENT: "Pull request is closed",
        APPROVE: "Pull request is closed",
        REQUEST_CHANGES: "Pull request is closed",
      },
    ],
  ])("for %s", (_, input, expected) => {
    const rules = submitRules({ ...otherPr, ...input });

    expect(
      Object.fromEntries(rules.map(({ event, disabledReason }) => [event, disabledReason])),
    ).toEqual(expected);
  });

  it("lists the verdicts in the order Comment, Approve, Request changes", () => {
    expect(submitRules(otherPr).map(({ event }) => event)).toEqual([
      "COMMENT",
      "APPROVE",
      "REQUEST_CHANGES",
    ]);
  });
});
