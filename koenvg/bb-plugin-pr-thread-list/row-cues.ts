import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

export const isBusy = (thread: PluginSidebarThread) =>
  thread.status === "starting" || thread.status === "active" || thread.status === "stopping";

export const hasActivity = ({ activity }: PluginSidebarThread) =>
  activity.workflows +
    activity.backgroundAgents +
    activity.backgroundCommands +
    activity.planMode +
    activity.goals >
  0;

export function needsAttention(thread: PluginSidebarThread): boolean {
  return (
    thread.hasPendingInteraction ||
    thread.queuedWork === "failed" ||
    thread.indicator === "waiting-for-input" ||
    thread.indicator === "unread-error" ||
    thread.indicator === "queued-failed"
  );
}

export const isActive = (thread: PluginSidebarThread) =>
  needsAttention(thread) || isBusy(thread) || hasActivity(thread) || thread.queuedWork !== "none";

export function isSettled(thread: PluginSidebarThread): boolean {
  return (
    !thread.isPinned &&
    !thread.isUnread &&
    !isBusy(thread) &&
    !hasActivity(thread) &&
    thread.indicator === "none" &&
    thread.queuedWork === "none" &&
    !thread.hasPendingInteraction
  );
}

/** Keep BB's accessible status wording; survive new kinds without guessing. */
export function describeIndicator(thread: PluginSidebarThread): string | null {
  if (thread.indicatorLabel) return thread.indicatorLabel;
  switch (thread.indicator) {
    case "none":
      return null;
    case "queued-waiting":
      return "Queued message waiting";
    case "queued-failed":
      return "Queued message failed";
    case "waiting-for-input":
      return "Thread needs user input";
    case "unread-error":
      return "Unread thread error";
    case "unread-success":
      return "Unread thread success";
    case "runtime":
      return `Thread ${thread.runtimeStatus}`;
    case "background-agent":
      return "Background agent running";
    case "background-command":
      return "Background command running";
    case "workflow":
      return "Workflow running";
    case "goal":
      return "Goal running";
    case "plan-mode":
      return "Plan mode";
    case "working-draft":
      return "Working with an unsent draft";
    case "draft":
      return "Unsent draft";
    default:
      return `Thread status: ${thread.runtimeStatus || thread.status || "idle"}`;
  }
}

export interface WorkItem {
  key: string;
  icon: string;
  text: string;
  title: string;
  error: boolean;
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

export function workItems(thread: PluginSidebarThread): WorkItem[] {
  const items: WorkItem[] = [];
  if (thread.queuedWork === "failed")
    items.push({
      key: "queued",
      icon: "AlertCircle",
      text: "Not sent",
      title: "Queued message failed",
      error: true,
    });
  else if (thread.queuedWork !== "none")
    items.push({
      key: "queued",
      icon: "Clock",
      text: "Queued",
      title: "Queued message waiting",
      error: false,
    });
  const { workflows, backgroundAgents, backgroundCommands, planMode, goals } = thread.activity;
  const counts: [string, string, number, string][] = [
    ["workflows", "Workflow", workflows, "workflow"],
    ["agents", "Bot", backgroundAgents, "background agent"],
    ["commands", "Terminal", backgroundCommands, "background command"],
  ];
  for (const [key, icon, count, noun] of counts)
    if (count > 0)
      items.push({ key, icon, text: String(count), title: plural(count, noun), error: false });
  if (planMode > 0)
    items.push({ key: "plan", icon: "ListTodo", text: "Plan", title: "Plan mode", error: false });
  if (goals > 0)
    items.push({
      key: "goals",
      icon: "Target",
      text: String(goals),
      title: plural(goals, "goal"),
      error: false,
    });
  return items;
}

const UNITS: [number, string][] = [
  [365 * 86_400_000, "y"],
  [7 * 86_400_000, "w"],
  [86_400_000, "d"],
  [3_600_000, "h"],
  [60_000, "m"],
];

export function relativeTime(at: number, now: number): string {
  const elapsed = now - at;
  for (const [size, unit] of UNITS)
    if (elapsed >= size) return `${Math.floor(elapsed / size)}${unit}`;
  return "now";
}

export interface RowState {
  label: string;
  title: string;
  tone: "danger" | "live" | "muted";
}

const LIVE_INDICATORS: Partial<Record<PluginSidebarThread["indicator"], string>> = {
  runtime: "Working",
  "working-draft": "Drafting",
  workflow: "Workflow",
  "background-agent": "Agent",
  "background-command": "Command",
  "plan-mode": "Planning",
  goal: "Goal",
};

function baseState(thread: PluginSidebarThread, hasDraft: boolean): RowState | null {
  const state = (label: string, title: string, tone: RowState["tone"]): RowState => ({
    label,
    title,
    tone,
  });
  if (thread.hasPendingInteraction || thread.indicator === "waiting-for-input")
    return state("Needs you", "Thread needs user input", "danger");
  if (thread.indicator === "unread-error") return state("Failed", "Unread thread error", "danger");
  if (thread.queuedWork === "failed" || thread.indicator === "queued-failed")
    return state("Not sent", "Queued message failed", "danger");
  const live = LIVE_INDICATORS[thread.indicator];
  if (live) return state(live, live, "live");
  if (isBusy(thread)) return state("Working", `Thread ${thread.runtimeStatus}`, "live");
  if (hasActivity(thread)) return state("Background", "Background work running", "live");
  if (thread.indicator === "draft" || hasDraft) return state("Draft", "Unsent draft", "muted");
  return null;
}

export function rowState(thread: PluginSidebarThread, hasDraft: boolean): RowState | null {
  const state = baseState(thread, hasDraft);
  return state && { ...state, title: describeIndicator(thread) ?? state.title };
}
