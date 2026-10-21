// @vitest-environment jsdom
import { afterAll, afterEach, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { useEffect, useState } from "react";
import type { rpcContract } from "../contract";
import { prOperations } from "./pr-operations";

// React DOM imports Scheduler through CommonJS. Install its controlled clock
// before loading React DOM so we can stop between paint and passive effects.
const require = createRequire(import.meta.url);
const realScheduler = require("scheduler");
const originalScheduler = { ...realScheduler };
const scheduler = require("scheduler/unstable_mock") as {
  unstable_flushUntilNextPaint(): void;
  unstable_flushAllWithoutAsserting(): void;
};
Object.assign(realScheduler, scheduler);
const { cleanup, fireEvent } = await import("@testing-library/react");
const { installTestPluginRuntime, renderSlot } = await import("@get-bb/plugin-sdk/testing/app");
installTestPluginRuntime();
const { MergeActionButton } = await import("./merge-action-button");
afterAll(() => Object.assign(realScheduler, originalScheduler));

const pr = {
  number: 7,
  title: "Add palette commands",
  state: "open",
  url: "https://github.com/o/r/pull/7",
  headOid: "abc123",
  headRefName: "feature",
  headOwner: null,
  isCrossRepository: false,
  baseRefName: "main",
  author: "koenvg",
  additions: 1,
  deletions: 0,
  changedFiles: 1,
} as const;

afterEach(() => {
  cleanup();
  scheduler.unstable_flushAllWithoutAsserting();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("keeps an enqueue error when the RPC finishes before the button subscribes", async () => {
  let show!: () => void;
  const ready = new Promise<void>((resolve) => {
    show = resolve;
  });
  function DelayedButton() {
    const [visible, setVisible] = useState(false);
    useEffect(() => {
      void ready.then(() => setVisible(true));
    }, []);
    return visible ? (
      <MergeActionButton threadId="thr_early" pr={pr} action={{ kind: "enqueue" }} />
    ) : null;
  }
  const message = "Pull request is not mergeable";
  const run = vi.spyOn(prOperations, "run");
  const subscribe = vi.spyOn(prOperations, "subscribe");
  const slot = renderSlot<{}, typeof rpcContract>(
    { component: DelayedButton },
    {},
    { rpc: { runPrAction: () => ({ kind: "error", message }) } as never },
  );

  // Hold the passive effect while the already visible button is clicked.
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", false);
  show();
  await ready;
  await Promise.resolve();
  scheduler.unstable_flushUntilNextPaint();
  const button = slot.getByRole("button", { name: "Enqueue" });
  expect(subscribe).not.toHaveBeenCalled();
  fireEvent.click(button);
  expect(run).toHaveBeenCalledTimes(1);
  await run.mock.results[0]!.value;
  expect(subscribe).not.toHaveBeenCalled();
  expect(slot.inspection.rpcCalls).toEqual([
    {
      method: "runPrAction",
      input: { threadId: "thr_early", action: "enqueue", expectedHeadOid: pr.headOid },
    },
  ]);
  scheduler.unstable_flushAllWithoutAsserting();

  expect(subscribe).toHaveBeenCalled();
  expect(slot.getByRole("alert").textContent).toBe(message);
  expect(slot.getByRole("button", { name: "Enqueue" })).toHaveProperty("disabled", false);
});
