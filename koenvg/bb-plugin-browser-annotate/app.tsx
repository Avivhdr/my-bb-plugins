import { useEffect, useMemo, useRef, useState } from "react";
import {
  definePluginApp,
  useComposers,
  useRealtime,
  useRpc,
  useSdk,
  type PluginComposerApi,
} from "@get-bb/plugin-sdk/app";
import { CHANGED_CHANNEL } from "./lib/annotation";
import type { rpcContract } from "./lib/contract";
import { createAnnotateController, type AnnotateController } from "./lib/controller";
import { createHiddenPins, type HiddenPins } from "./lib/hidden-pins";
import { createPillTracker } from "./lib/pill-tracker";
import { renderAnnotatedJpeg } from "./lib/render";
import {
  annotationIdsInDraft,
  createTabCapturer,
  findThreadComposer,
  insertAnnotationPill,
  registerBrowserToolbarAction,
  registerHeadlessOverlay,
  removeAnnotationPill,
  type BrowserTabProps,
} from "./lib/sdk-adapter";
import { useHostTheme } from "./lib/theme";

const INSTALL_CHECK_MS = 1000;

type ThreadComposer = PluginComposerApi & { scope: { kind: "thread"; threadId: string } };

function isThreadComposer(composer: PluginComposerApi): composer is ThreadComposer {
  return composer.scope.kind === "thread";
}

function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

export function AnnotateControl({
  threadId,
  tabId,
  url,
  page,
  hiddenPins,
}: BrowserTabProps & { hiddenPins: HiddenPins }) {
  const rpc = useRpc<typeof rpcContract>();
  const sdk = useSdk();
  const capturer = useMemo(() => createTabCapturer(sdk), [sdk]);
  const composers = useComposers();
  const composer = useLatest(findThreadComposer(composers, threadId));
  const [on, setOn] = useState(false);
  const [controller, setController] = useState<AnnotateController | null>(null);

  useEffect(() => {
    if (!page) return;
    const created = createAnnotateController({
      threadId,
      tabId,
      page,
      rpc,
      capture: (tab) => capturer.capture(tab),
      render: renderAnnotatedJpeg,
      pills: () => {
        const current = composer.current;
        return (
          current && {
            insert: (pill) => insertAnnotationPill(current, pill),
            remove: (id) => removeAnnotationPill(current, id),
          }
        );
      },
      isHidden: (id) => hiddenPins.has(id),
      onModeChange: setOn,
    });
    const timer = setInterval(() => void created.ensureInstalled(), INSTALL_CHECK_MS);
    setController(created);
    return () => {
      clearInterval(timer);
      created.dispose();
      setController(null);
      setOn(false);
    };
  }, [threadId, tabId, page, rpc, capturer, composer, hiddenPins]);

  useEffect(() => {
    if (!controller) return;
    return hiddenPins.subscribe(() => void controller.applyHidden());
  }, [controller, hiddenPins]);

  useEffect(() => {
    void controller?.attach(url);
  }, [controller, url]);

  const theme = useHostTheme();
  useEffect(() => {
    void controller?.setTheme(theme);
  }, [controller, theme]);

  useRealtime(CHANGED_CHANNEL, (payload) => {
    if ((payload as { threadId?: unknown } | null)?.threadId === threadId) {
      void controller?.refreshPins();
    }
  });

  if (!page) return null;

  const setMode = (next: boolean) => {
    setOn(next);
    void controller?.setMode(next);
  };

  return (
    <button
      type="button"
      className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring aria-pressed:bg-state-active aria-pressed:text-foreground"
      aria-pressed={on}
      aria-label={on ? "Stop annotating" : "Annotate page"}
      title={on ? "Stop annotating (Esc)" : "Annotate page"}
      onClick={() => setMode(!on)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && on) {
          event.preventDefault();
          setMode(false);
        }
      }}
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    </button>
  );
}

export function PillSync({ hiddenPins }: { hiddenPins: HiddenPins }) {
  const rpc = useRpc<typeof rpcContract>();
  const tracker = useMemo(
    () =>
      createPillTracker({
        remove: (threadId, id) => rpc.call("remove", { threadId, id }),
        clearResolved: (threadId) => rpc.call("clearResolved", { threadId }),
        hide: (id) => hiddenPins.hide(id),
        show: (id) => hiddenPins.show(id),
      }),
    [rpc, hiddenPins],
  );
  const threadComposers = useComposers().filter(isThreadComposer);
  const drafts = threadComposers.map((composer) => ({
    threadId: composer.scope.threadId,
    ids: annotationIdsInDraft(composer.draft),
  }));
  const draftKey = JSON.stringify(drafts);
  const latestDrafts = useLatest(drafts);
  const latestComposers = useLatest(threadComposers);
  const composerKey = threadComposers.map((composer) => composer.key).join("\u0000");

  useEffect(() => () => tracker.dispose(), [tracker]);
  useEffect(() => {
    for (const { threadId, ids } of latestDrafts.current) tracker.observe(threadId, ids);
  }, [draftKey, tracker, latestDrafts]);
  useEffect(() => {
    const unsubscribes = latestComposers.current.map((composer) =>
      composer.onSubmitted(() => tracker.submitted(composer.scope.threadId)),
    );
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [composerKey, tracker, latestComposers]);

  return null;
}

export default definePluginApp((app) => {
  const hiddenPins = createHiddenPins();
  registerBrowserToolbarAction(app, {
    id: "annotate",
    title: "Annotate page",
    component: (props) => <AnnotateControl {...props} hiddenPins={hiddenPins} />,
  });
  registerHeadlessOverlay(app, {
    id: "pill-sync",
    component: () => <PillSync hiddenPins={hiddenPins} />,
  });
});
