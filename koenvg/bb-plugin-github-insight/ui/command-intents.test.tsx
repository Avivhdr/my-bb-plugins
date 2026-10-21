// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import {
  peekIntent,
  postIntent,
  useCommandIntent,
  type CommandTab,
  type IntentOf,
} from "./command-intents";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function listen<Tab extends CommandTab>(threadId: string, tab: Tab) {
  const received: IntentOf<Tab>[] = [];
  const hook = renderHook(() => useCommandIntent(threadId, tab, (intent) => received.push(intent)));
  return { received, unmount: hook.unmount };
}

describe("command intents", () => {
  it("hands an intent to the mounted tab of its thread at once", () => {
    const tab = listen("thr_mounted", "overview");

    postIntent("thr_mounted", "overview", "refresh");

    expect(tab.received).toEqual(["refresh"]);
  });

  it("keeps an intent until the tab of its thread mounts", () => {
    postIntent("thr_later", "files", "submit");

    expect(listen("thr_later", "files").received).toEqual(["submit"]);
  });

  it("hands an intent to its thread and tab only", () => {
    const otherThread = listen("thr_other", "overview");
    const otherTab = listen("thr_own", "files");

    postIntent("thr_own", "overview", "refresh");

    expect(otherThread.received).toEqual([]);
    expect(otherTab.received).toEqual([]);
    expect(listen("thr_own", "overview").received).toEqual(["refresh"]);
  });

  it("hands a pending intent over once", () => {
    postIntent("thr_once", "overview", "refresh");
    listen("thr_once", "overview").unmount();

    expect(listen("thr_once", "overview").received).toEqual([]);
  });

  it("keeps only the last pending intent", () => {
    postIntent("thr_last", "overview", "open-on-github");
    postIntent("thr_last", "overview", "refresh");

    expect(listen("thr_last", "overview").received).toEqual(["refresh"]);
  });

  it("drops a pending intent older than 10 seconds", () => {
    vi.useFakeTimers();
    postIntent("thr_old", "overview", "refresh");
    vi.advanceTimersByTime(10_001);

    expect(listen("thr_old", "overview").received).toEqual([]);
  });

  it("hands intents to the last mounted tab, and back to the earlier one when it unmounts", () => {
    const earlier = listen("thr_two", "overview");
    const later = listen("thr_two", "overview");

    postIntent("thr_two", "overview", "refresh");
    later.unmount();
    postIntent("thr_two", "overview", "open-on-github");

    expect(later.received).toEqual(["refresh"]);
    expect(earlier.received).toEqual(["open-on-github"]);
  });

  it("stops handing intents to an unmounted tab", () => {
    const tab = listen("thr_gone", "overview");
    tab.unmount();

    postIntent("thr_gone", "overview", "refresh");

    expect(tab.received).toEqual([]);
  });

  it("shows a pending intent without handing it over", () => {
    postIntent("thr_peek", "pr", "show-files");

    expect(peekIntent("thr_peek", "pr")).toBe("show-files");
    expect(listen("thr_peek", "pr").received).toEqual(["show-files"]);
    expect(peekIntent("thr_peek", "pr")).toBeNull();
  });
});
