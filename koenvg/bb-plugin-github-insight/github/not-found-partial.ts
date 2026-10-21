import { z } from "zod";

const notFoundPartialSchema = z.object({
  data: z.record(z.string(), z.unknown()),
  errors: z.array(z.object({ type: z.literal("NOT_FOUND") }).passthrough()).min(1),
});

export function readNotFoundPartial(stdout: string): unknown | null {
  let response: unknown;
  try {
    response = JSON.parse(stdout);
  } catch {
    return null;
  }
  return notFoundPartialSchema.safeParse(response).success ? response : null;
}
