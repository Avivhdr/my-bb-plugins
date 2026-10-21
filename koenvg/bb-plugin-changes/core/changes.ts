import { z } from "zod";

export const diffTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("all") }).strict(),
  z.object({ kind: z.literal("uncommitted") }).strict(),
  z.object({ kind: z.literal("branch_committed") }).strict(),
  z.object({ kind: z.literal("commit"), sha: z.string().min(1) }).strict(),
]);
export type DiffTarget = z.infer<typeof diffTargetSchema>;

export const diffQuerySchema = z.discriminatedUnion("target", [
  z.object({ target: z.literal("uncommitted") }).strict(),
  z
    .object({ target: z.enum(["all", "branch_committed"]), mergeBaseBranch: z.string().min(1) })
    .strict(),
  z.object({ target: z.literal("commit"), sha: z.string().min(1) }).strict(),
]);
export type DiffQuery = z.infer<typeof diffQuerySchema>;

export const changedFileSchema = z.object({
  path: z.string(),
  previousPath: z.string().nullable(),
  additions: z.number(),
  deletions: z.number(),
  binary: z.boolean(),
  loadMode: z.enum(["auto", "on_demand", "too_large"]),
  status: z.enum([
    "added",
    "modified",
    "deleted",
    "renamed",
    "copied",
    "type_changed",
    "untracked",
  ]),
});
export type ChangedFile = z.infer<typeof changedFileSchema>;

export const branchCommitSchema = z.object({
  sha: z.string(),
  shortSha: z.string(),
  subject: z.string(),
});
export type BranchCommit = z.infer<typeof branchCommitSchema>;

export const changesBasisSchema = z.object({
  environmentId: z.string().min(1),
  headSha: z.string(),
  mergeBaseRef: z.string().nullable(),
  target: diffTargetSchema,
});
export type ChangesBasis = z.infer<typeof changesBasisSchema>;

export const changesResultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ok"),
    environmentId: z.string().min(1),
    query: diffQuerySchema,
    imageBasis: changesBasisSchema.nullable().default(null),
    files: z.array(changedFileSchema),
    patches: z.record(z.string(), z.string()),
    commits: z.array(branchCommitSchema),
  }),
  z.object({ kind: z.literal("no_git") }),
  z.object({ kind: z.literal("error"), message: z.string() }),
]);
export type ChangesResult = z.infer<typeof changesResultSchema>;

export const patchesResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ok"), patches: z.record(z.string(), z.string()) }),
  z.object({ kind: z.literal("error"), message: z.string() }),
]);
export type PatchesResult = z.infer<typeof patchesResultSchema>;

export const sendFeedbackResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("sent"), delivery: z.enum(["sent", "queued"]) }),
  z.object({ kind: z.literal("error"), message: z.string() }),
]);
export type SendFeedbackResult = z.infer<typeof sendFeedbackResultSchema>;

export function diffQuery(target: DiffTarget, baseBranch: string): DiffQuery {
  switch (target.kind) {
    case "uncommitted":
      return { target: "uncommitted" };
    case "commit":
      return { target: "commit", sha: target.sha };
    case "all":
    case "branch_committed":
      return { target: target.kind, mergeBaseBranch: baseBranch };
  }
}

export function targetOf(query: DiffQuery): DiffTarget {
  return query.target === "commit" ? { kind: "commit", sha: query.sha } : { kind: query.target };
}

export function targetKey(target: DiffTarget): string {
  return target.kind === "commit" ? `commit:${target.sha}` : target.kind;
}

export type PatchTarget =
  | { type: "uncommitted" }
  | { type: "all" | "branch_committed"; mergeBaseBranch: string }
  | { type: "commit"; sha: string };

export function patchTarget(query: DiffQuery): PatchTarget {
  if (query.target === "uncommitted") return { type: "uncommitted" };
  if (query.target === "commit") return { type: "commit", sha: query.sha };
  return { type: query.target, mergeBaseBranch: query.mergeBaseBranch };
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
