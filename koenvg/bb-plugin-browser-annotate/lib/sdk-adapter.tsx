import { useMemo, type ComponentType } from "react";
import type {
  ComposerDraft,
  ComposerMention,
  ExperimentalPluginBrowserPage,
  PluginAppBuilder,
  PluginBrowserBbSdk,
  PluginComposerApi,
} from "@get-bb/plugin-sdk/app";
import { MENTION_PROVIDER_ID } from "./annotation";

export const PLUGIN_ID = "browser-annotate";

export interface PageScripting {
  evaluate(expression: string): Promise<unknown>;
  onMessage(listener: (data: unknown) => void): () => void;
}

export interface BrowserTabProps {
  threadId: string;
  tabId: string;
  url: string;
  page: PageScripting | null;
}

export function registerBrowserToolbarAction(
  app: PluginAppBuilder,
  registration: { id: string; title: string; component: ComponentType<BrowserTabProps> },
) {
  const Component = registration.component;
  app.slots.experimental_browserToolbarAction({
    id: registration.id,
    title: registration.title,
    component: ({ threadId, tabId, url, experimental_page }) => {
      const page = usePageScripting(experimental_page);
      return <Component threadId={threadId} tabId={tabId} url={url} page={page} />;
    },
  });
}

function usePageScripting(page: ExperimentalPluginBrowserPage | null): PageScripting | null {
  return useMemo(
    () =>
      page && {
        evaluate: (expression) => page.evaluate(expression, { world: "isolated" }),
        onMessage: (listener) => page.onMessage(listener),
      },
    [page],
  );
}

export function registerHeadlessOverlay(
  app: PluginAppBuilder,
  registration: { id: string; component: ComponentType },
) {
  app.slots.experimental_appOverlay(registration);
}

export interface TabCapture {
  base64: string;
  width: number;
  height: number;
}

type DesktopBrowsers = PluginBrowserBbSdk["experimental_desktopBrowsers"];
type TabRequest = Parameters<DesktopBrowsers["captureTab"]>[0];
type TabLocation = Omit<TabRequest, "tabId" | "threadId">;

export interface TabCapturer {
  capture(tab: { threadId: string; tabId: string }): Promise<TabCapture>;
}

export function createTabCapturer(
  sdk: Pick<PluginBrowserBbSdk, "hosts" | "experimental_desktopBrowsers">,
): TabCapturer {
  const locations = new Map<string, TabLocation>();
  const browsers = sdk.experimental_desktopBrowsers;

  async function locate(threadId: string, tabId: string): Promise<TabLocation> {
    for (const host of await sdk.hosts.list()) {
      const { instances } = await browsers
        .listInstances({ hostId: host.id })
        .catch(() => ({ instances: [] }));
      for (const { instanceId, generation } of instances) {
        const scope = { hostId: host.id, instanceId, generation, threadId };
        const { tabs } = await browsers.listTabs(scope).catch(() => ({ tabs: [] }));
        if (tabs.some((tab) => tab.tabId === tabId))
          return { hostId: host.id, instanceId, generation };
      }
    }
    throw new Error("The Browser tab could not be found for a screenshot.");
  }

  async function captureAt(location: TabLocation, threadId: string, tabId: string) {
    const { base64, width, height } = await browsers.captureTab({ ...location, threadId, tabId });
    return { base64, width, height };
  }

  return {
    async capture({ threadId, tabId }) {
      const key = `${threadId}\u0000${tabId}`;
      const cached = locations.get(key);
      if (cached) {
        try {
          return await captureAt(cached, threadId, tabId);
        } catch {
          locations.delete(key);
        }
      }
      const location = await locate(threadId, tabId);
      locations.set(key, location);
      return captureAt(location, threadId, tabId);
    },
  };
}

export function findThreadComposer(
  composers: readonly PluginComposerApi[],
  threadId: string,
): PluginComposerApi | null {
  return (
    composers.find(
      (composer) => composer.scope.kind === "thread" && composer.scope.threadId === threadId,
    ) ?? null
  );
}

function isAnnotationMention(
  mention: ComposerMention,
): mention is Extract<ComposerMention, { kind: "plugin" }> {
  return (
    mention.kind === "plugin" &&
    mention.pluginId === PLUGIN_ID &&
    mention.provider === MENTION_PROVIDER_ID
  );
}

export function annotationIdsInDraft(draft: ComposerDraft): string[] {
  return draft.mentions.filter(isAnnotationMention).map((mention) => mention.id);
}

export function insertAnnotationPill(
  composer: PluginComposerApi,
  pill: { id: string; label: string },
) {
  composer.insert([{ provider: MENTION_PROVIDER_ID, id: pill.id, label: pill.label }, " "], {
    at: "end",
  });
}

export function withoutAnnotationPill(draft: ComposerDraft, id: string): ComposerDraft {
  const removed = draft.mentions.filter(
    (mention) => isAnnotationMention(mention) && mention.id === id,
  );
  if (removed.length === 0) return draft;
  let text = draft.text;
  let mentions = draft.mentions.filter((mention) => !removed.includes(mention));
  for (const target of [...removed].sort((a, b) => b.from - a.from)) {
    const end = text[target.to] === " " ? target.to + 1 : target.to;
    const length = end - target.from;
    text = text.slice(0, target.from) + text.slice(end);
    mentions = mentions.map((mention) =>
      mention.from >= end
        ? { ...mention, from: mention.from - length, to: mention.to - length }
        : mention,
    );
  }
  return { text, mentions };
}

export function removeAnnotationPill(composer: PluginComposerApi, id: string) {
  composer.replace((current) => withoutAnnotationPill(current, id));
}
