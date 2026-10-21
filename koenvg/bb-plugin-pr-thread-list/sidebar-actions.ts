import {
  experimental_useThreadActions,
  useBbNavigate,
  useSdk,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";

interface NewThreadScope {
  projectId?: string;
  environmentId?: string;
  sectionId?: string;
  focusPrompt?: boolean;
}

export interface ThreadListNavigation {
  open(threadId: string, options?: { split?: boolean }): void;
  openNewThread(scope: NewThreadScope): void;
}

export interface ThreadListActions extends ThreadListNavigation {
  togglePinned(): Promise<void>;
  toggleRead(): Promise<void>;
  rename(title: string): Promise<unknown>;
  archive(): Promise<void>;
  requestDelete(): Promise<void>;
}

export function useThreadListNavigation(): ThreadListNavigation {
  const navigate = useBbNavigate();
  return {
    open: (threadId, options) => navigate.toThread(threadId, options),
    openNewThread: ({ sectionId, ...scope }) =>
      navigate.toCompose({
        ...scope,
        ...(sectionId === undefined ? {} : { placement: { sectionId, pinned: false } }),
      }),
  };
}

/** Row-bound native actions retain the host's archive and delete safeguards. */
export function useThreadListActions(thread: PluginSidebarThread): ThreadListActions {
  const navigate = useThreadListNavigation();
  const sdk = useSdk();
  const entries = experimental_useThreadActions({
    ...thread,
    environment: thread.environment?.id
      ? { id: thread.environment.id, path: thread.environment.path }
      : null,
  });
  const run = (id: string) => {
    const entry = entries.find((entry) => entry.key === `bb--core/${id}`);
    if (!entry || entry.action.disabled)
      throw new Error("Thread action unavailable. Reopen the menu.");
    return entry.action.run();
  };
  return {
    ...navigate,
    togglePinned: () => run("pin"),
    toggleRead: () => run("read"),
    rename: (title) => sdk.threads.update({ threadId: thread.id, title }),
    archive: () => run("archive"),
    requestDelete: () => run("delete"),
  };
}
