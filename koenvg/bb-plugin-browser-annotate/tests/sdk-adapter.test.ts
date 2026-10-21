import { describe, expect, it, vi } from "vitest";
import type { ComposerDraft, ComposerMention } from "@get-bb/plugin-sdk/app";
import { annotationIdsInDraft, createTabCapturer, withoutAnnotationPill } from "../lib/sdk-adapter";

type PluginMention = Extract<ComposerMention, { kind: "plugin" }>;

function pill(id: string, from: number, label: string): PluginMention {
  return {
    kind: "plugin",
    pluginId: "browser-annotate",
    provider: "annotation",
    id,
    from,
    to: from + label.length,
    label,
  };
}

describe("withoutAnnotationPill", () => {
  it("removes the pill and its trailing space and shifts later mentions", () => {
    const draft: ComposerDraft = {
      text: "fix 1 · button 2 · region done",
      mentions: [pill("a", 4, "1 · button"), pill("b", 15, "2 · region")],
    };

    const next = withoutAnnotationPill(draft, "a");

    expect(next.text).toBe("fix 2 · region done");
    expect(next.mentions).toEqual([pill("b", 4, "2 · region")]);
    expect(annotationIdsInDraft(next)).toEqual(["b"]);
  });

  it("keeps the draft when the pill is absent", () => {
    const draft: ComposerDraft = { text: "hello", mentions: [] };

    expect(withoutAnnotationPill(draft, "a")).toBe(draft);
  });

  it("ignores pills of other plugins with the same id", () => {
    const other: ComposerMention = { ...pill("a", 0, "x"), pluginId: "other" };

    expect(annotationIdsInDraft({ text: "x", mentions: [other] })).toEqual([]);
  });
});

describe("createTabCapturer", () => {
  function fakeSdk() {
    const captureTab = vi.fn(async () => ({
      base64: "AAA",
      width: 2880,
      height: 1800,
      mimeType: "image/jpeg" as const,
    }));
    const listTabs = vi.fn(async ({ instanceId }: { instanceId: string }) => ({
      tabs: instanceId === "win-2" ? [{ tabId: "tab-1" }] : [],
    }));
    const sdk = {
      hosts: { list: vi.fn(async () => [{ id: "host-1" }]) },
      experimental_desktopBrowsers: {
        listInstances: vi.fn(async () => ({
          instances: [
            { instanceId: "win-1", generation: "g1", label: "1", hostId: "host-1" },
            { instanceId: "win-2", generation: "g2", label: "2", hostId: "host-1" },
          ],
        })),
        listTabs,
        captureTab,
      },
    };
    return { sdk, captureTab, listTabs };
  }

  it("finds the window that owns the tab and reuses it for the next capture", async () => {
    const { sdk, captureTab, listTabs } = fakeSdk();
    const capturer = createTabCapturer(sdk as never);

    await capturer.capture({ threadId: "thr", tabId: "tab-1" });
    const second = await capturer.capture({ threadId: "thr", tabId: "tab-1" });

    expect(second).toEqual({ base64: "AAA", width: 2880, height: 1800 });
    expect(listTabs).toHaveBeenCalledTimes(2);
    expect(captureTab).toHaveBeenLastCalledWith({
      hostId: "host-1",
      instanceId: "win-2",
      generation: "g2",
      threadId: "thr",
      tabId: "tab-1",
    });
  });

  it("fails clearly when no window has the tab", async () => {
    const { sdk } = fakeSdk();

    await expect(
      createTabCapturer(sdk as never).capture({ threadId: "thr", tabId: "nope" }),
    ).rejects.toThrow("could not be found");
  });
});
