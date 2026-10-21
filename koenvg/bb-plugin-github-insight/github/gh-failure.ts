import { z } from "zod";

export const ghFailureSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("gh_missing") }),
  z.object({ kind: z.literal("gh_logged_out") }),
  z.object({ kind: z.literal("rate_limited"), resetAt: z.number().nullable() }),
  z.object({ kind: z.literal("failed"), message: z.string() }),
]);
export type GhFailure = z.infer<typeof ghFailureSchema>;

export interface GhProcessError {
  code: string | number | undefined;
  stderr: string;
  message: string;
}

const EXIT_AUTH_REQUIRED = 4;
const LOGGED_OUT = /gh auth login|Bad credentials|HTTP 401/;
const RATE_LIMITED = /rate limit/i;
const GITHUB_TIMEOUT = /HTTP 504|unexpected end of JSON input/i;

export function isRateLimitMessage(message: string): boolean {
  return RATE_LIMITED.test(message);
}

export function isGithubTimeout(failure: GhFailure): boolean {
  return failure.kind === "failed" && GITHUB_TIMEOUT.test(failure.message);
}

export function classifyGhFailure(error: GhProcessError): GhFailure {
  if (error.code === "ENOENT") return { kind: "gh_missing" };
  const stderr = error.stderr.trim();
  if (RATE_LIMITED.test(stderr)) return { kind: "rate_limited", resetAt: null };
  if (error.code === EXIT_AUTH_REQUIRED || LOGGED_OUT.test(stderr)) {
    return { kind: "gh_logged_out" };
  }
  return { kind: "failed", message: stderr === "" ? error.message : stderr };
}

export function ghFailureText(failure: GhFailure): string {
  switch (failure.kind) {
    case "gh_missing":
      return "gh not installed";
    case "gh_logged_out":
      return "gh not logged in";
    case "rate_limited":
      return "rate limited";
    case "failed":
      return failure.message;
  }
}

export const RATE_LIMITED_TEXT = ghFailureText({ kind: "rate_limited", resetAt: null });

export class GhFailureError extends Error {
  constructor(readonly failure: GhFailure) {
    super(ghFailureText(failure));
  }
}

export const RATE_LIMIT_ARGS = ["api", "rate_limit"];

const rateLimitSchema = z.object({
  resources: z.object({
    graphql: z.object({ remaining: z.number(), reset: z.number() }),
  }),
});

export function parseGraphqlRateLimitReset(response: unknown): number | null {
  const parsed = rateLimitSchema.safeParse(response);
  if (!parsed.success) return null;
  const { remaining, reset } = parsed.data.resources.graphql;
  return remaining === 0 ? reset * 1000 : null;
}
