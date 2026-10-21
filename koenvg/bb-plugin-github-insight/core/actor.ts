import { z } from "zod";

export const actorSchema = z
  .object({ __typename: z.string(), login: z.string().optional() })
  .nullable();

export function isOtherPerson(
  actor: { __typename?: string; login?: string } | null | undefined,
  viewer: string,
): boolean {
  return actor?.__typename === "User" && actor.login !== viewer;
}
