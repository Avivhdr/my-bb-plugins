import { useMemo } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { PullRequestRef } from "../core/pr-ref";

export const PANEL_PATH = "pull-requests";

export type PullRequestsRoute =
  | { kind: "list"; selected: PullRequestRef | null }
  | { kind: "review"; repo: string; number: number };

export const LIST_ROUTE: PullRequestsRoute = { kind: "list", selected: null };

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function parsePullRequestsRoute(subPath: string): PullRequestsRoute {
  const segments = subPath
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(decodeSegment);
  const [head, owner, repo, number] = segments;
  if (
    segments.length === 4 &&
    owner !== undefined &&
    repo !== undefined &&
    number !== undefined &&
    /^[1-9]\d*$/.test(number)
  ) {
    if (head === "review")
      return { kind: "review", repo: `${owner}/${repo}`, number: Number(number) };
    if (head === "pr") return { kind: "list", selected: { owner, repo, number: Number(number) } };
  }
  return LIST_ROUTE;
}

function prSubPath(head: string, { owner, repo, number }: PullRequestRef): string {
  return `${head}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${number}`;
}

export function pullRequestsRouteToSubPath(route: PullRequestsRoute): string {
  if (route.kind === "list") return route.selected === null ? "" : prSubPath("pr", route.selected);
  const [owner = "", repo = ""] = route.repo.split("/");
  return prSubPath("review", { owner, repo, number: route.number });
}

export function usePullRequestsNavigation() {
  const navigate = useBbNavigate();
  return useMemo(
    () => ({
      go: (route: PullRequestsRoute) =>
        navigate.toPluginPanel(PANEL_PATH, { subPath: pullRequestsRouteToSubPath(route) }),
      toThread: (threadId: string) => navigate.toThread(threadId),
    }),
    [navigate],
  );
}
