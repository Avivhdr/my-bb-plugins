import { z } from "zod";
import {
  checkRunNodeSchema,
  checkSchema,
  failingCheckRunIds,
  type Check,
  latestCheckCandidates,
  markWaitingStatuses,
  statusContextNodeSchema,
  toCheck,
} from "./checks";
import {
  blockerSchema,
  buildBlockers,
  type Blocker,
  mergeableSchema,
  mergeStateStatusSchema,
  reviewDecisionSchema,
} from "./blockers";
import { autoMergeActionSchema, buildAutoMergeAction, type AutoMergeAction } from "./auto-merge";
import { canUpdateBranch } from "./branch-update";
import { parseFailureAnnotations, type Annotation } from "./failure";
import { mergeQueueEntrySchema, mergeQueueSchema, toMergeQueue } from "./merge-queue";
import {
  buildMergeAction,
  mergeActionSchema,
  mergeMethodSchema,
  type MergeAction,
} from "./merge-action";
import {
  buildReviewers,
  reviewerSchema,
  reviewNodeSchema,
  reviewRequestNodeSchema,
} from "./reviewers";

export const MAX_CONTEXT_PAGES = 5;

const overviewPageSchema = z.object({
  data: z.object({
    repository: z.object({
      pullRequest: z.object({
        number: z.number(),
        title: z.string(),
        state: z.enum(["OPEN", "CLOSED", "MERGED"]),
        isDraft: z.boolean(),
        url: z.string(),
        commits: z.object({
          nodes: z.array(
            z.object({
              commit: z.object({
                statusCheckRollup: z
                  .object({
                    contexts: z.object({
                      pageInfo: z.object({
                        hasNextPage: z.boolean(),
                        endCursor: z.string().nullable(),
                      }),
                      nodes: z.array(
                        z.discriminatedUnion("__typename", [
                          checkRunNodeSchema,
                          statusContextNodeSchema,
                        ]),
                      ),
                    }),
                  })
                  .nullable(),
              }),
            }),
          ),
        }),
      }),
    }),
  }),
});
type OverviewPage = z.infer<typeof overviewPageSchema>;

const firstPageSchema = z.object({
  data: z.object({
    repository: z.object({
      viewerDefaultMergeMethod: mergeMethodSchema,
      mergeCommitAllowed: z.boolean(),
      squashMergeAllowed: z.boolean(),
      rebaseMergeAllowed: z.boolean(),
      autoMergeAllowed: z.boolean(),
      pullRequest: z.object({
        id: z.string(),
        headRefOid: z.string(),
        isMergeQueueEnabled: z.boolean(),
        mergeable: mergeableSchema,
        mergeStateStatus: mergeStateStatusSchema,
        mergeQueueEntry: mergeQueueEntrySchema,
        headRefName: z.string(),
        baseRefName: z.string(),
        isCrossRepository: z.boolean(),
        headRepositoryOwner: z.object({ login: z.string() }).nullable(),
        author: z.object({ login: z.string() }).nullable(),
        additions: z.number(),
        deletions: z.number(),
        changedFiles: z.number(),
        autoMergeRequest: z.object({ mergeMethod: mergeMethodSchema }).nullable(),
        reviewDecision: reviewDecisionSchema,
        reviewRequests: z.object({ nodes: z.array(reviewRequestNodeSchema) }),
        latestOpinionatedReviews: z.object({ nodes: z.array(reviewNodeSchema) }),
        reviewThreads: z.object({
          nodes: z.array(z.object({ isResolved: z.boolean() })),
        }),
      }),
    }),
  }),
});
type FirstPageRepository = z.infer<typeof firstPageSchema>["data"]["repository"];
type ReviewState = FirstPageRepository["pullRequest"];
type MergeSettings = Omit<FirstPageRepository, "pullRequest">;

const prStateSchema = z.enum(["open", "draft", "closed", "merged"]);
type PrState = z.infer<typeof prStateSchema>;

const PR_STATE: Record<OverviewPage["data"]["repository"]["pullRequest"]["state"], PrState> = {
  OPEN: "open",
  CLOSED: "closed",
  MERGED: "merged",
};

export const prInsightSchema = z.object({
  pr: z.object({
    number: z.number(),
    title: z.string(),
    state: prStateSchema,
    url: z.string(),
    headOid: z.string(),
    headRefName: z.string(),
    headOwner: z.string().nullable(),
    isCrossRepository: z.boolean(),
    baseRefName: z.string(),
    author: z.string().nullable(),
    additions: z.number(),
    deletions: z.number(),
    changedFiles: z.number(),
  }),
  mergeAction: mergeActionSchema,
  autoMergeAction: autoMergeActionSchema,
  canUpdateBranch: z.boolean(),
  blockers: z.array(blockerSchema),
  reviewers: z.array(reviewerSchema),
  checks: z.array(checkSchema),
  mergeQueue: mergeQueueSchema,
});
export type PrInsight = z.infer<typeof prInsightSchema>;

export interface PrReading {
  insight: PrInsight;
  pullRequestId: string;
}

function contextsOf(page: OverviewPage) {
  const [head] = page.data.repository.pullRequest.commits.nodes;
  return head?.commit.statusCheckRollup?.contexts ?? null;
}

function nextContextsCursor(page: OverviewPage): string | null {
  const contexts = contextsOf(page);
  if (contexts === null || !contexts.pageInfo.hasNextPage) return null;
  return contexts.pageInfo.endCursor;
}

export interface GitHubReader {
  fetchOverviewPage: (after: string | null) => Promise<unknown>;
  fetchCheckRunDetails: (ids: string[]) => Promise<unknown>;
}

async function readOverviewPages(fetchOverviewPage: GitHubReader["fetchOverviewPage"]): Promise<{
  pages: [OverviewPage, ...OverviewPage[]];
  reviewState: ReviewState;
  mergeSettings: MergeSettings;
}> {
  const firstResponse = await fetchOverviewPage(null);
  const first = overviewPageSchema.parse(firstResponse);
  const { pullRequest: reviewState, ...mergeSettings } =
    firstPageSchema.parse(firstResponse).data.repository;
  const pages: [OverviewPage, ...OverviewPage[]] = [first];
  let after = nextContextsCursor(first);
  while (after !== null && pages.length < MAX_CONTEXT_PAGES) {
    const page = overviewPageSchema.parse(await fetchOverviewPage(after));
    pages.push(page);
    after = nextContextsCursor(page);
  }
  return { pages, reviewState, mergeSettings };
}

async function readFailureAnnotations(
  fetchCheckRunDetails: GitHubReader["fetchCheckRunDetails"],
  ids: string[],
): Promise<Map<string, Annotation[]>> {
  if (ids.length === 0) return new Map();
  return parseFailureAnnotations(await fetchCheckRunDetails(ids));
}

function prHeader(page: OverviewPage, reviewState: ReviewState): PrInsight["pr"] {
  const pr = page.data.repository.pullRequest;
  const state = pr.isDraft && pr.state === "OPEN" ? "draft" : PR_STATE[pr.state];
  return {
    number: pr.number,
    title: pr.title,
    state,
    url: pr.url,
    headOid: reviewState.headRefOid,
    headRefName: reviewState.headRefName,
    headOwner: reviewState.isCrossRepository
      ? (reviewState.headRepositoryOwner?.login ?? null)
      : null,
    isCrossRepository: reviewState.isCrossRepository,
    baseRefName: reviewState.baseRefName,
    author: reviewState.author?.login ?? null,
    additions: reviewState.additions,
    deletions: reviewState.deletions,
    changedFiles: reviewState.changedFiles,
  };
}

function blockers(
  reviewState: ReviewState,
  prState: PrInsight["pr"]["state"],
  checks: readonly Check[],
  mergeQueue: PrInsight["mergeQueue"],
): Blocker[] {
  return buildBlockers({
    prState,
    mergeQueue,
    mergeable: reviewState.mergeable,
    mergeStateStatus: reviewState.mergeStateStatus,
    reviewDecision: reviewState.reviewDecision,
    unresolvedThreads: reviewState.reviewThreads.nodes.filter((thread) => !thread.isResolved)
      .length,
    checks,
  });
}

function mergeAction(
  reviewState: ReviewState,
  settings: MergeSettings,
  prState: PrInsight["pr"]["state"],
  prBlockers: readonly Blocker[],
  mergeQueue: PrInsight["mergeQueue"],
): MergeAction {
  return buildMergeAction({
    prState,
    blockers: prBlockers,
    isMergeQueueEnabled: reviewState.isMergeQueueEnabled,
    isInMergeQueue: mergeQueue !== null,
    defaultMethod: settings.viewerDefaultMergeMethod,
    allowedMethods: allowedMethods(settings),
  });
}

function allowedMethods(settings: MergeSettings) {
  return {
    MERGE: settings.mergeCommitAllowed,
    SQUASH: settings.squashMergeAllowed,
    REBASE: settings.rebaseMergeAllowed,
  };
}

function autoMergeAction(
  reviewState: ReviewState,
  settings: MergeSettings,
  prState: PrInsight["pr"]["state"],
  prBlockers: readonly Blocker[],
): AutoMergeAction {
  return buildAutoMergeAction({
    prState,
    blockers: prBlockers,
    isMergeQueueEnabled: reviewState.isMergeQueueEnabled,
    autoMergeAllowed: settings.autoMergeAllowed,
    autoMergeMethod: reviewState.autoMergeRequest?.mergeMethod ?? null,
    defaultMethod: settings.viewerDefaultMergeMethod,
    allowedMethods: allowedMethods(settings),
  });
}

export async function collectInsight(
  github: GitHubReader,
  now: number = Date.now(),
): Promise<PrReading> {
  const { pages, reviewState, mergeSettings } = await readOverviewPages(github.fetchOverviewPage);
  const latest = markWaitingStatuses(
    latestCheckCandidates(pages.flatMap((page) => contextsOf(page)?.nodes ?? [])),
    now,
  );
  const annotations = await readFailureAnnotations(
    github.fetchCheckRunDetails,
    failingCheckRunIds(latest),
  );
  const pr = prHeader(pages[0], reviewState);
  const checks = latest.map((candidate) => toCheck(candidate, annotations));
  const mergeQueue = toMergeQueue(reviewState.mergeQueueEntry);
  const prBlockers = blockers(reviewState, pr.state, checks, mergeQueue);
  return {
    insight: {
      pr,
      mergeAction: mergeAction(reviewState, mergeSettings, pr.state, prBlockers, mergeQueue),
      autoMergeAction: autoMergeAction(reviewState, mergeSettings, pr.state, prBlockers),
      canUpdateBranch: canUpdateBranch({
        prState: pr.state,
        mergeable: reviewState.mergeable,
        mergeStateStatus: reviewState.mergeStateStatus,
        mergeQueue,
      }),
      blockers: prBlockers,
      reviewers: buildReviewers(
        reviewState.reviewRequests.nodes,
        reviewState.latestOpinionatedReviews.nodes,
      ),
      checks,
      mergeQueue,
    },
    pullRequestId: reviewState.id,
  };
}
