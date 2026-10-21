import { z } from "zod";

export const CHANGED_CHANNEL = "annotations:changed";
export const MENTION_PROVIDER_ID = "annotation";
export const MAX_COMMENT_LENGTH = 4000;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_BASE64_LENGTH = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const sizeSchema = z.number().finite().nonnegative();

export const rectSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: sizeSchema,
  height: sizeSchema,
});
export const viewportSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
});
export const commentSchema = z
  .string()
  .max(MAX_COMMENT_LENGTH)
  .refine((comment) => comment.trim().length > 0, "A comment cannot be blank.");
export const kindSchema = z.string().regex(/^(region|[a-z][a-z0-9-]{0,31})$/);

export type Rect = z.infer<typeof rectSchema>;
export type Viewport = z.infer<typeof viewportSchema>;

export const annotationSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  url: z.string(),
  urlKey: z.string(),
  number: z.number().int(),
  kind: z.string(),
  comment: z.string(),
  rect: rectSchema,
  isFixed: z.boolean(),
  viewport: viewportSchema,
});
export type Annotation = z.infer<typeof annotationSchema>;

export const createInputSchema = z.object({
  threadId: idSchema,
  url: z.string().min(1).max(8192),
  number: z.number().int().positive(),
  kind: kindSchema,
  comment: commentSchema,
  rect: rectSchema,
  isFixed: z.boolean(),
  viewport: viewportSchema,
  imageBase64: z.string().min(1).max(MAX_IMAGE_BASE64_LENGTH),
});
export type CreateInput = z.infer<typeof createInputSchema>;

export const threadScopedIdSchema = z.object({ threadId: idSchema, id: idSchema });

export function pillLabel(annotation: Pick<Annotation, "number" | "kind">): string {
  return `${annotation.number} · ${annotation.kind}`;
}

export function urlKey(url: string): string {
  const hash = url.indexOf("#");
  return hash === -1 ? url : url.slice(0, hash);
}
