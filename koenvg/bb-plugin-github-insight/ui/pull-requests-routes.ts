import { useMemo } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { PullRequestRef } from "../core/pr-ref";

export const PANEL_PATH = "pull-requests";

export type ListTab = "review" | "activity";

/** A comment the PR view scrolls to: in the conversation, or an inline comment in Files. */
export interface RouteFocus {
  kind: "conversation" | "inline";
  commentId: string;
}

export type PullRequestsRoute =
  | {
      kind: "list";
      selected: PullRequestRef | null;
      /** The list tab. Missing means "review". */
      tab?: ListTab;
      focus?: RouteFocus | null;
    }
  | { kind: "review"; repo: string; number: number };

export const LIST_ROUTE: PullRequestsRoute = { kind: "list", selected: null };
export const ACTIVITY_ROUTE: PullRequestsRoute = { kind: "list", selected: null, tab: "activity" };

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function focusOf(kind: string | undefined, commentId: string | undefined): RouteFocus | null {
  if (commentId === undefined || (kind !== "conversation" && kind !== "inline")) return null;
  return { kind, commentId };
}

export function parsePullRequestsRoute(subPath: string): PullRequestsRoute {
  const all = subPath
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(decodeSegment);
  const activity = all[0] === "activity";
  const segments = activity ? all.slice(1) : all;
  const list = (route: { selected: PullRequestRef | null; focus?: RouteFocus | null }) =>
    activity
      ? ({ kind: "list", tab: "activity", ...route } as const)
      : ({ kind: "list", ...route } as const);
  const [head, owner, repo, number, focusKind, commentId] = segments;
  if (
    (segments.length === 4 || segments.length === 6) &&
    owner !== undefined &&
    repo !== undefined &&
    number !== undefined &&
    /^[1-9]\d*$/.test(number)
  ) {
    if (head === "review" && !activity && segments.length === 4)
      return { kind: "review", repo: `${owner}/${repo}`, number: Number(number) };
    if (head === "pr") {
      const selected = { owner, repo, number: Number(number) };
      const focus = focusOf(focusKind, commentId);
      return focus === null ? list({ selected }) : list({ selected, focus });
    }
  }
  return list({ selected: null });
}

function prSubPath(head: string, { owner, repo, number }: PullRequestRef): string {
  return `${head}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${number}`;
}

export function pullRequestsRouteToSubPath(route: PullRequestsRoute): string {
  if (route.kind === "list") {
    const parts = [
      ...(route.tab === "activity" ? ["activity"] : []),
      ...(route.selected === null ? [] : [prSubPath("pr", route.selected)]),
      ...(route.selected !== null && route.focus
        ? [route.focus.kind, encodeURIComponent(route.focus.commentId)]
        : []),
    ];
    return parts.join("/");
  }
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
