import { z } from "zod";

export const MAX_SHOWN_ANNOTATIONS = 5;

const annotationNodeSchema = z.object({
  annotationLevel: z.enum(["FAILURE", "WARNING", "NOTICE"]).nullable(),
  message: z.string(),
  path: z.string(),
  location: z.object({ start: z.object({ line: z.number() }) }),
});
export type AnnotationNode = z.infer<typeof annotationNodeSchema>;

const checkRunDetailsSchema = z.object({
  data: z.object({
    nodes: z.array(
      z
        .object({
          id: z.string(),
          annotations: z.object({ nodes: z.array(annotationNodeSchema) }),
        })
        .nullable(),
    ),
  }),
});

export const annotationSchema = z.object({
  path: z.string(),
  line: z.number(),
  message: z.string(),
});
export type Annotation = z.infer<typeof annotationSchema>;

export const checkFailureSchema = z.object({
  reason: z.string(),
  annotations: z.array(annotationSchema),
  annotationCount: z.number(),
});
export type CheckFailure = z.infer<typeof checkFailureSchema>;

export function parseFailureAnnotations(response: unknown): Map<string, Annotation[]> {
  const runs = checkRunDetailsSchema.parse(response).data.nodes;
  const byRunId = new Map<string, Annotation[]>();
  for (const run of runs) {
    if (run === null) continue;
    byRunId.set(
      run.id,
      run.annotations.nodes
        .filter((node) => node.annotationLevel === "FAILURE")
        .map((node) => ({
          path: node.path,
          line: node.location.start.line,
          message: node.message,
        })),
    );
  }
  return byRunId;
}

function firstNonEmpty(...texts: (string | null | undefined)[]): string {
  return texts.find((text) => text != null && text.trim() !== "") ?? "";
}

export function checkFailure(
  reasonTexts: readonly (string | null)[],
  annotations: readonly Annotation[],
): CheckFailure {
  return {
    reason: firstNonEmpty(...reasonTexts, annotations[0]?.message),
    annotations: annotations.slice(0, MAX_SHOWN_ANNOTATIONS),
    annotationCount: annotations.length,
  };
}
