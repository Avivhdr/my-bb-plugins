import {
  definePluginApp,
  experimental_Icon as Icon,
  experimental_useSidebarThreads,
  experimental_useThreadActions,
  type PluginSidebarThread,
  type PluginThreadHeaderActionProps,
} from "@get-bb/plugin-sdk/app";

const ARCHIVE = "bb--core/archive";

// Runs bb's own Archive action, so its confirmation for threads with
// children, pane cleanup and Undo toast all still apply.
function ArchiveButton({ thread, compact }: { thread: PluginSidebarThread; compact: boolean }) {
  const [entry] = experimental_useThreadActions(
    {
      ...thread,
      environment: thread.environment?.id ? { id: thread.environment.id, path: thread.environment.path } : null,
    },
    { keys: [ARCHIVE] },
  );
  if (!entry || entry.action.disabled) return null;
  const { label, icon } = entry.action;
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={() => void entry.action.run()}
      className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md bg-destructive/10 px-2.5 text-xs font-medium text-destructive hover:bg-destructive/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <Icon name={icon} fallback="Archive" aria-hidden className="size-3.5" />
      {compact ? null : label}
    </button>
  );
}

function ThreadArchiveButton({ threadId, isCompactViewport }: PluginThreadHeaderActionProps) {
  const { threads } = experimental_useSidebarThreads();
  const thread = threads.find((candidate) => candidate.id === threadId);
  if (!thread || thread.isArchived) return null;
  return <ArchiveButton thread={thread} compact={isCompactViewport} />;
}

export default definePluginApp((app) => {
  app.slots.experimental_threadHeaderAction({
    id: "archive",
    title: "Archive thread",
    component: ThreadArchiveButton,
  });
});
