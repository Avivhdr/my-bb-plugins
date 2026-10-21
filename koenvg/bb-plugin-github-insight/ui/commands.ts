import type { PluginCommandContext, PluginCommandRegistration } from "@get-bb/plugin-sdk/app";
import { postIntent, type CommandTab, type IntentOf } from "./command-intents";
import { canMerge, hasPr } from "./pr-availability";

type ThreadCheck = (threadId: string) => boolean;

function availableWhen(check: ThreadCheck) {
  return (context: PluginCommandContext) => context.threadId !== null && check(context.threadId);
}

type PostedIntent = { [Tab in CommandTab]: { tab: Tab; intent: IntentOf<Tab> } }[CommandTab];

const SHOW_OVERVIEW = { tab: "pr", intent: "show-overview" } as const;
const SHOW_FILES = { tab: "pr", intent: "show-files" } as const;

function prTabCommand(
  id: string,
  title: string,
  ...intents: PostedIntent[]
): PluginCommandRegistration {
  return {
    id,
    title,
    isAvailable: availableWhen(hasPr),
    run: (context) => {
      const { threadId } = context;
      if (threadId === null || !context.openPanel({ actionId: "pr" })) return;
      for (const { tab, intent } of intents) postIntent(threadId, tab, intent);
    },
  };
}

export const GITHUB_COMMANDS: readonly PluginCommandRegistration[] = [
  {
    id: "merge-pr",
    title: "GitHub: Merge PR",
    isAvailable: availableWhen(canMerge),
    run: ({ threadId }) => {
      if (threadId !== null) postIntent(threadId, "merge", "merge");
    },
  },
  prTabCommand("open-pr-tab", "GitHub: Open PR tab", SHOW_OVERVIEW),
  prTabCommand("open-pr-files", "GitHub: Open PR files", SHOW_FILES),
  prTabCommand("submit-review", "GitHub: Submit review", SHOW_FILES, {
    tab: "files",
    intent: "submit",
  }),
  prTabCommand("next-comment", "GitHub: Next comment", SHOW_FILES, {
    tab: "files",
    intent: "next-comment",
  }),
  prTabCommand("previous-comment", "GitHub: Previous comment", SHOW_FILES, {
    tab: "files",
    intent: "previous-comment",
  }),
  prTabCommand("refresh-pr", "GitHub: Refresh PR", SHOW_OVERVIEW, {
    tab: "overview",
    intent: "refresh",
  }),
  prTabCommand("open-pr-on-github", "GitHub: Open PR on GitHub", {
    tab: "overview",
    intent: "open-on-github",
  }),
];
