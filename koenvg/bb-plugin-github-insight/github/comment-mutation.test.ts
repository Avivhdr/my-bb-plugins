import { describe, expect, it } from "vitest";
import { addCommentArgs } from "./comment-mutation";

describe("addCommentArgs", () => {
  it("sends the PR node id and the body as raw strings", () => {
    const args = addCommentArgs({ subjectId: "PR_1", body: "@notes.md is fine" });

    expect(args).toEqual(
      expect.arrayContaining(["-f", "subjectId=PR_1", "-f", "body=@notes.md is fine"]),
    );
    expect(args).not.toContain("-F");
  });
});
