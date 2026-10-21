import { z } from "zod";
import { defineRpcContract } from "@get-bb/plugin-sdk";
import type { PluginRpcClient } from "@get-bb/plugin-sdk/app";
import {
  annotationSchema,
  commentSchema,
  createInputSchema,
  threadScopedIdSchema,
} from "./annotation";

const threadIdSchema = z.object({ threadId: z.string().min(1).max(128) });
const removedSchema = z.object({ removed: z.array(z.string()) });

export const rpcContract = defineRpcContract({
  create: { input: createInputSchema, output: annotationSchema.extend({ label: z.string() }) },
  update: {
    input: threadScopedIdSchema.extend({ comment: commentSchema }),
    output: annotationSchema,
  },
  remove: { input: threadScopedIdSchema, output: removedSchema },
  listForUrl: {
    input: threadIdSchema.extend({ url: z.string().min(1).max(8192) }),
    output: z.array(annotationSchema),
  },
  listForThread: { input: threadIdSchema, output: z.array(annotationSchema) },
  clearResolved: { input: threadIdSchema, output: removedSchema },
});

export type AnnotationsRpc = Pick<PluginRpcClient<typeof rpcContract>, "call">;
