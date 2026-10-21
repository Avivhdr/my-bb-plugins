import { z } from "zod";
import { checkFailure, checkFailureSchema, type Annotation } from "./failure";

export const checkRunNodeSchema = z.object({
  __typename: z.literal("CheckRun"),
  id: z.string(),
  databaseId: z.number(),
  name: z.string(),
  status: z.enum(["COMPLETED", "IN_PROGRESS", "PENDING", "QUEUED", "REQUESTED", "WAITING"]),
  conclusion: z
    .enum([
      "ACTION_REQUIRED",
      "CANCELLED",
      "FAILURE",
      "NEUTRAL",
      "SKIPPED",
      "STALE",
      "STARTUP_FAILURE",
      "SUCCESS",
      "TIMED_OUT",
    ])
    .nullable(),
  detailsUrl: z.string().nullable(),
  startedAt: z.string().nullable(),
  title: z.string().nullable(),
  summary: z.string().nullable(),
  isRequired: z.boolean(),
});
export type CheckRunNode = z.infer<typeof checkRunNodeSchema>;

export const statusContextNodeSchema = z.object({
  __typename: z.literal("StatusContext"),
  context: z.string(),
  state: z.enum(["ERROR", "EXPECTED", "FAILURE", "PENDING", "SUCCESS"]),
  description: z.string().nullable(),
  targetUrl: z.string().nullable(),
  createdAt: z.string(),
  isRequired: z.boolean(),
});
export type StatusContextNode = z.infer<typeof statusContextNodeSchema>;

export type CheckNode = CheckRunNode | StatusContextNode;

export const checkStatusSchema = z.enum([
  "failed",
  "waiting",
  "running",
  "cancelled",
  "passed",
  "skipped",
]);
export type CheckStatus = z.infer<typeof checkStatusSchema>;

export const checkSchema = z.object({
  name: z.string(),
  status: checkStatusSchema,
  url: z.string().nullable(),
  required: z.boolean(),
  failure: checkFailureSchema.nullable(),
});
export type Check = z.infer<typeof checkSchema>;

const CONCLUSION_STATUS: Record<NonNullable<CheckRunNode["conclusion"]>, CheckStatus> = {
  FAILURE: "failed",
  TIMED_OUT: "failed",
  ACTION_REQUIRED: "failed",
  STARTUP_FAILURE: "failed",
  CANCELLED: "cancelled",
  STALE: "cancelled",
  SUCCESS: "passed",
  SKIPPED: "skipped",
  NEUTRAL: "skipped",
};

const CONTEXT_STATE_STATUS: Record<StatusContextNode["state"], CheckStatus> = {
  ERROR: "failed",
  FAILURE: "failed",
  PENDING: "running",
  EXPECTED: "running",
  SUCCESS: "passed",
};

export function mapCheckRunStatus(
  status: CheckRunNode["status"],
  conclusion: CheckRunNode["conclusion"],
): CheckStatus {
  if (status !== "COMPLETED" || conclusion === null) return "running";
  return CONCLUSION_STATUS[conclusion];
}

export function mapStatusContextState(state: StatusContextNode["state"]): CheckStatus {
  return CONTEXT_STATE_STATUS[state];
}

const FAILING_STATUSES: ReadonlySet<CheckStatus> = new Set(["failed", "cancelled"]);

const NOT_STARTED = Number.POSITIVE_INFINITY;

export interface CheckCandidate {
  name: string;
  source: "check_run" | "status";
  status: CheckStatus;
  url: string | null;
  runId: string | null;
  required: boolean;
  reasonTexts: readonly (string | null)[];
  recency: readonly [time: number, tieBreak: number];
}

function toCandidate(node: CheckNode): CheckCandidate {
  if (node.__typename === "CheckRun") {
    return {
      name: node.name,
      source: "check_run",
      status: mapCheckRunStatus(node.status, node.conclusion),
      url: node.detailsUrl,
      runId: node.id,
      required: node.isRequired,
      reasonTexts: [node.title, node.summary],
      recency: [
        node.startedAt === null ? NOT_STARTED : Date.parse(node.startedAt),
        node.databaseId,
      ],
    };
  }
  return {
    name: node.context,
    source: "status",
    status: mapStatusContextState(node.state),
    url: node.targetUrl,
    runId: null,
    required: node.isRequired,
    // A status context has no annotations, so its description can come first.
    reasonTexts: [node.description],
    recency: [Date.parse(node.createdAt), 0],
  };
}

function isNewer(candidate: CheckCandidate, current: CheckCandidate): boolean {
  const [candidateTime, candidateTieBreak] = candidate.recency;
  const [currentTime, currentTieBreak] = current.recency;
  if (candidateTime !== currentTime) return candidateTime > currentTime;
  return candidateTieBreak > currentTieBreak;
}

export function latestCheckCandidates(nodes: readonly CheckNode[]): CheckCandidate[] {
  const newestByName = new Map<string, Map<CheckCandidate["source"], CheckCandidate>>();
  for (const candidate of nodes.map(toCandidate)) {
    const newestBySource =
      newestByName.get(candidate.name) ?? new Map<CheckCandidate["source"], CheckCandidate>();
    const current = newestBySource.get(candidate.source);
    // A newer attempt can start before an older one, or not have started yet.
    const newer =
      current === undefined ||
      (candidate.source === "check_run"
        ? candidate.recency[1] > current.recency[1]
        : isNewer(candidate, current));
    if (newer) newestBySource.set(candidate.source, candidate);
    newestByName.set(candidate.name, newestBySource);
  }
  return [...newestByName.values()].map((newestBySource) =>
    [...newestBySource.values()].reduce((current, candidate) =>
      isNewer(candidate, current) ? candidate : current,
    ),
  );
}

export const QUIET_STATUS_MS = 3 * 60_000;

// GitHub has no state for "waits for a person", so a pending commit status that
// stops updating after every check run is done is taken as waiting for the user.
export function markWaitingStatuses(
  candidates: readonly CheckCandidate[],
  now: number,
): CheckCandidate[] {
  const checkRunRunning = candidates.some(
    (candidate) => candidate.source === "check_run" && candidate.status === "running",
  );
  return candidates.map((candidate) =>
    !checkRunRunning &&
    candidate.source === "status" &&
    candidate.status === "running" &&
    now - candidate.recency[0] >= QUIET_STATUS_MS
      ? { ...candidate, status: "waiting" }
      : candidate,
  );
}

export function failingCheckRunIds(candidates: readonly CheckCandidate[]): string[] {
  return candidates.flatMap((candidate) =>
    candidate.runId !== null && FAILING_STATUSES.has(candidate.status) ? [candidate.runId] : [],
  );
}

export function toCheck(
  candidate: CheckCandidate,
  annotationsByRunId: ReadonlyMap<string, readonly Annotation[]>,
): Check {
  const { name, status, url, runId, required, reasonTexts } = candidate;
  const annotations = runId === null ? [] : (annotationsByRunId.get(runId) ?? []);
  return {
    name,
    status,
    url,
    required,
    failure: FAILING_STATUSES.has(status) ? checkFailure(reasonTexts, annotations) : null,
  };
}
