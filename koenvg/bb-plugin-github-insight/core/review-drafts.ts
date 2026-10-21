import { z } from "zod";
import { draftSchema } from "./drafts";

export const summaryDraftSchema = draftSchema;
export type SummaryDraft = z.infer<typeof summaryDraftSchema>;

export const commentDraftSchema = draftSchema.extend({
  path: z.string().min(1),
  side: z.enum(["LEFT", "RIGHT"]),
  line: z.number().int().positive(),
  startLine: z.number().int().positive().nullable(),
  commitOid: z.string().min(1),
});
export type CommentDraft = z.infer<typeof commentDraftSchema>;

export const listedCommentDraftSchema = commentDraftSchema.extend({ id: z.string().min(1) });
export type ListedCommentDraft = z.infer<typeof listedCommentDraftSchema>;

const commentDraftEntrySchema = commentDraftSchema.extend({ v: z.literal(1) });
const summaryDraftEntrySchema = summaryDraftSchema.extend({ v: z.literal(1) });

export function commentDraftEntry(draft: CommentDraft) {
  return { v: 1, ...draft };
}

export function summaryDraftEntry(draft: SummaryDraft) {
  return { v: 1, ...draft };
}

export function readCommentDraft(entry: unknown): CommentDraft | null {
  const parsed = commentDraftEntrySchema.safeParse(entry);
  if (!parsed.success) return null;
  const { v: _, ...draft } = parsed.data;
  return draft;
}

export function readSummaryDraft(entry: unknown): SummaryDraft | null {
  const parsed = summaryDraftEntrySchema.safeParse(entry);
  if (!parsed.success) return null;
  const { v: _, ...draft } = parsed.data;
  return draft;
}

export function newCommentDraftId(): string {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 8);
}

export function hasText(body: string): boolean {
  return body.trim() !== "";
}
