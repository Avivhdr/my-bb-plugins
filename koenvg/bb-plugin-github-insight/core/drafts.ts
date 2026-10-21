import { z } from "zod";

export const draftSchema = z.object({
  body: z.string(),
  updatedAt: z.number(),
  source: z.enum(["agent", "user"]),
});
export type Draft = z.infer<typeof draftSchema>;

export const draftsSchema = z.record(z.string(), draftSchema);
export type Drafts = z.infer<typeof draftsSchema>;
