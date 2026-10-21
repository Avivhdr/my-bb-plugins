import { describe, expect, it } from "vitest";
import { createPendingReviewStore } from "./pending-review";

const LINE_42 = { path: "src/a.ts", side: "additions", line: 42 } as const;
const OLD_10 = { path: "src/a.ts", side: "deletions", line: 10 } as const;

function store() {
  let next = 0;
  return createPendingReviewStore(() => `c${++next}`);
}

describe("pending review store", () => {
  it("keeps the reviews of two threads apart", () => {
    const reviews = store();

    reviews.addComment("thr_a", LINE_42, "Null check missing");

    expect(reviews.get("thr_a").comments).toEqual([
      { ...LINE_42, id: "c1", body: "Null check missing" },
    ]);
    expect(reviews.get("thr_b").comments).toEqual([]);
  });

  it("removes only the given comment ids", () => {
    const reviews = store();
    reviews.addComment("thr_a", LINE_42, "one");
    reviews.addComment("thr_a", OLD_10, "two");
    reviews.addComment("thr_a", LINE_42, "three");

    reviews.removeComments("thr_a", ["c1", "c3"]);

    expect(reviews.get("thr_a").comments.map((comment) => comment.id)).toEqual(["c2"]);
  });

  it("keeps form text per line and side until the comment is added", () => {
    const reviews = store();
    reviews.openForm("thr_a", LINE_42);
    reviews.setFormText("thr_a", LINE_42, "draft");
    reviews.openForm("thr_a", OLD_10);

    reviews.openForm("thr_a", LINE_42);
    expect([...reviews.get("thr_a").openForms.values()]).toEqual([
      { anchor: LINE_42, text: "draft" },
      { anchor: OLD_10, text: "" },
    ]);

    reviews.addComment("thr_a", LINE_42, "draft");
    expect(reviews.get("thr_a").openForms.size).toBe(1);
  });

  it("drops form text on close", () => {
    const reviews = store();
    reviews.setFormText("thr_a", LINE_42, "draft");

    reviews.closeForm("thr_a", LINE_42);

    expect(reviews.get("thr_a").openForms.size).toBe(0);
  });

  it("tells subscribers about every change and returns a new snapshot", () => {
    const reviews = store();
    const before = reviews.get("thr_a");
    let calls = 0;
    const unsubscribe = reviews.subscribe(() => calls++);

    reviews.addComment("thr_a", LINE_42, "x");
    unsubscribe();
    reviews.addComment("thr_a", LINE_42, "y");

    expect(calls).toBe(1);
    expect(reviews.get("thr_a")).not.toBe(before);
  });
});
