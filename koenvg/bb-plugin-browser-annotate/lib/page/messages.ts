import { z } from "zod";
import { commentSchema, kindSchema, rectSchema, viewportSchema } from "../annotation";
import { clipRect } from "../geometry";

const idSchema = z.string().min(1).max(128);

const pageMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("save"),
    url: z.string().min(1).max(8192),
    kind: kindSchema,
    comment: commentSchema,
    rect: rectSchema,
    scroll: z.object({ x: z.number().finite(), y: z.number().finite() }),
    isFixed: z.boolean(),
    viewport: viewportSchema,
  }),
  z.object({ type: z.literal("update"), id: idSchema, comment: commentSchema }),
  z.object({ type: z.literal("delete"), id: idSchema }),
  z.object({ type: z.literal("mode"), on: z.boolean() }),
]);

export type PageMessage = z.infer<typeof pageMessageSchema>;
export type SaveMessage = Extract<PageMessage, { type: "save" }>;

export function parsePageMessage(data: unknown): PageMessage | null {
  const parsed = pageMessageSchema.safeParse(data);
  if (!parsed.success) return null;
  const message = parsed.data;
  if (message.type !== "save") return message;
  const rect = clipRect(message.rect, message.viewport);
  if (rect.width <= 0 || rect.height <= 0) return null;
  return { ...message, rect };
}
