import type {
  ComposerMention,
  ExperimentalPluginBrowserPage,
  ExperimentalPluginBrowserToolbarActionProps,
  PluginAppSlots,
  PluginBrowserBbSdk,
  PluginComposerApi,
} from "@get-bb/plugin-sdk/app";
import type { BbPluginApi, ExperimentalPluginMentionImage } from "@get-bb/plugin-sdk";

type Expect<T extends true> = T;
type Has<T, K extends PropertyKey> = K extends keyof T ? true : false;

export type SdkSurfaces = [
  Expect<Has<PluginAppSlots, "experimental_browserToolbarAction">>,
  Expect<Has<PluginAppSlots, "experimental_appOverlay">>,
  Expect<Has<ExperimentalPluginBrowserToolbarActionProps, "experimental_page">>,
  Expect<Has<ExperimentalPluginBrowserPage, "evaluate">>,
  Expect<Has<ExperimentalPluginBrowserPage, "onMessage">>,
  Expect<Has<PluginBrowserBbSdk["experimental_desktopBrowsers"], "captureTab">>,
  Expect<Has<PluginBrowserBbSdk["experimental_desktopBrowsers"], "listTabs">>,
  Expect<Has<PluginBrowserBbSdk["experimental_desktopBrowsers"], "listInstances">>,
  Expect<Has<PluginBrowserBbSdk["hosts"], "list">>,
  Expect<Has<PluginComposerApi, "insert">>,
  Expect<Has<PluginComposerApi, "replace">>,
  Expect<Has<PluginComposerApi, "draft">>,
  Expect<Has<PluginComposerApi, "onSubmitted">>,
  Expect<
    Extract<ComposerMention, { kind: "plugin" }> extends { provider: string; id: string }
      ? true
      : false
  >,
  Expect<Has<BbPluginApi["ui"], "registerMentionProvider">>,
  Expect<
    Extract<ExperimentalPluginMentionImage, { type: "localImage" }> extends { path: string }
      ? true
      : false
  >,
  Expect<Has<BbPluginApi["realtime"], "publish">>,
];
