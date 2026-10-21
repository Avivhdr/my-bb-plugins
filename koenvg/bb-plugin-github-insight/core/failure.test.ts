import { describe, expect, it } from "vitest";
import { checkFailure, parseFailureAnnotations, type AnnotationNode } from "./failure";

function annotation(
  level: AnnotationNode["annotationLevel"],
  message: string,
  line = 1,
): AnnotationNode {
  return {
    annotationLevel: level,
    message,
    path: "src/app.ts",
    location: { start: { line } },
  };
}

function detailsResponse(runs: Record<string, AnnotationNode[]>): unknown {
  return {
    data: {
      nodes: Object.entries(runs).map(([id, nodes]) => ({
        id,
        annotations: { nodes },
      })),
    },
  };
}

describe("parseFailureAnnotations", () => {
  it("drops warning and notice annotations", () => {
    const annotations = parseFailureAnnotations(
      detailsResponse({
        CR_1: [
          annotation("WARNING", "unused variable"),
          annotation("FAILURE", "Process completed with exit code 1.", 12),
          annotation("NOTICE", "cache hit"),
        ],
      }),
    );

    expect(annotations.get("CR_1")).toEqual([
      { path: "src/app.ts", line: 12, message: "Process completed with exit code 1." },
    ]);
  });

  it("skips runs that GitHub no longer knows", () => {
    const annotations = parseFailureAnnotations({ data: { nodes: [null] } });

    expect(annotations.size).toBe(0);
  });
});

describe("checkFailure", () => {
  it("uses the first failure annotation when the check has no reason text", () => {
    const failure = checkFailure(
      ["", null],
      [{ path: ".github", line: 1, message: "Process completed with exit code 1." }],
    );

    expect(failure.reason).toBe("Process completed with exit code 1.");
  });

  it("prefers the first reason text that is not blank", () => {
    const annotations = [{ path: "a", line: 1, message: "annotation" }];

    expect(checkFailure(["3 tests failed", "s"], annotations).reason).toBe("3 tests failed");
    expect(checkFailure([" ", "Lint failed"], annotations).reason).toBe("Lint failed");
  });

  it("shows at most 5 annotations and gives the total", () => {
    const annotations = Array.from({ length: 7 }, (_, index) => ({
      path: "src/app.ts",
      line: index + 1,
      message: `error ${index + 1}`,
    }));

    const failure = checkFailure([null, null], annotations);

    expect(failure.annotations.map((shown) => shown.line)).toEqual([1, 2, 3, 4, 5]);
    expect(failure.annotationCount).toBe(7);
  });

  it("gives an empty reason when there is no reason text", () => {
    expect(checkFailure([null, null], []).reason).toBe("");
  });
});
