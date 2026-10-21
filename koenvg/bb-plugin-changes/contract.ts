import { videoResultSchema } from "./core/video-content";
import { imagePathSchema, imageShaSchema } from "./core/image-content";

export const workspaceVideoRequestSchema = z
  .object({
    root: z.string().min(1),
    path: imagePathSchema,
    revision: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("working-tree") }),
      z.object({ kind: z.literal("commit"), sha: imageShaSchema, firstParent: z.boolean() }),
    ]),
  })
  .strict();
export const hostContract = defineRpcContract({
  readVideo: { input: workspaceVideoRequestSchema, output: videoResultSchema },
});
import { MAX_CONTEXT_BYTES, textContextResultSchema } from "./core/text-context";
import { imageResultSchema, imageSideSchema } from "./core/image-content";
import { changedFileSchema, changesBasisSchema } from "./core/changes";
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  changesResultSchema,
  diffQuerySchema,
  diffTargetSchema,
  patchesResultSchema,
  sendFeedbackResultSchema,
} from "./core/changes";
import {
  getViewedResultSchema,
  updateViewedResultSchema,
  viewedMarksSchema,
} from "./core/viewed-files";

export const rpcContract = defineRpcContract({
  getVideo: {
    input: z
      .object({
        threadId: z.string().min(1),
        basis: changesBasisSchema,
        file: changedFileSchema,
        side: imageSideSchema,
      })
      .strict(),
    output: videoResultSchema,
  },
  getTextContext: {
    input: z
      .object({
        threadId: z.string().min(1),
        basis: changesBasisSchema,
        file: changedFileSchema
          .extend({ path: imagePathSchema, previousPath: imagePathSchema.nullable() })
          .strict(),
        patch: z
          .string()
          .max(MAX_CONTEXT_BYTES)
          .refine((patch) => new TextEncoder().encode(patch).length <= MAX_CONTEXT_BYTES),
      })
      .strict(),
    output: textContextResultSchema,
  },
  getImage: {
    input: z
      .object({
        threadId: z.string().min(1),
        basis: changesBasisSchema,
        file: changedFileSchema,
        side: imageSideSchema,
      })
      .strict(),
    output: imageResultSchema,
  },
  getChanges: {
    input: z.object({ threadId: z.string().min(1), target: diffTargetSchema }).strict(),
    output: changesResultSchema,
  },
  getPatches: {
    input: z
      .object({
        threadId: z.string().min(1),
        query: diffQuerySchema,
        paths: z.array(z.string()).min(1),
      })
      .strict(),
    output: patchesResultSchema,
  },
  sendFeedback: {
    input: z.object({ threadId: z.string().min(1), text: z.string().regex(/\S/) }).strict(),
    output: sendFeedbackResultSchema,
  },
  getViewed: {
    input: z.object({ threadId: z.string().min(1), target: diffTargetSchema }).strict(),
    output: getViewedResultSchema,
  },
  updateViewed: {
    input: z
      .object({
        threadId: z.string().min(1),
        target: diffTargetSchema,
        set: viewedMarksSchema,
        remove: z.array(z.string()),
      })
      .strict(),
    output: updateViewedResultSchema,
  },
});
