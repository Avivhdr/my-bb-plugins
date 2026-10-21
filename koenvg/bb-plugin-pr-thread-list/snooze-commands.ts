import type { PluginCommandContext, PluginCommandRegistration } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { activeSnoozes, canSnooze, snoozePresets } from "./snooze-model";
import type { SnoozeClient, SnoozeSnapshot } from "./snooze-client";

const COMMANDS = [
  { id: "snooze-tomorrow", title: "Threads: Snooze until tomorrow", preset: "tomorrow" },
  { id: "snooze-next-week", title: "Threads: Snooze until next week", preset: "next-week" },
  { id: "wake-now", title: "Threads: Wake now", preset: null },
] as const;

type Command = (typeof COMMANDS)[number];

function applicable(
  snapshot: SnoozeSnapshot,
  context: PluginCommandContext,
  command: Command,
  now: Date,
) {
  if (!context.threadId || !snapshot.threadsReady || !snapshot.snoozesReady || !snapshot.controls)
    return null;
  const thread = snapshot.threads.find(({ id }) => id === context.threadId);
  if (!thread || !canSnooze(thread)) return null;
  const active = activeSnoozes(
    snapshot.threads,
    snapshot.snoozes,
    now.getTime(),
    snapshot.groups,
  ).has(thread.id);
  if (command.preset === null)
    return active ? { threadId: thread.id, controls: snapshot.controls, wakeAt: null } : null;
  if (active || !snapshot.controls.canSnooze(thread.id)) return null;
  const preset = snoozePresets(now).find(({ id }) => id === command.preset);
  return preset
    ? { threadId: thread.id, controls: snapshot.controls, wakeAt: preset.wakeAt }
    : null;
}

export function snoozeCommands(client: SnoozeClient): PluginCommandRegistration[] {
  return COMMANDS.map((command) => ({
    id: command.id,
    title: command.title,
    isAvailable: (context) =>
      applicable(client.getSnapshot(), context, command, new Date()) !== null,
    async run(context) {
      const action = applicable(client.getSnapshot(), context, command, new Date());
      if (!action) return;
      try {
        if (action.wakeAt === null) await action.controls.wake(action.threadId);
        else await action.controls.snooze(action.threadId, action.wakeAt);
      } catch {
        toast.error(
          action.wakeAt === null ? "Could not wake the thread." : "Could not snooze the thread.",
        );
      }
    },
  }));
}
