import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";

type Metadata = Record<string, Record<string, unknown>>;

async function setup(metadata: Metadata, options: { listThreads?: () => Promise<unknown> } = {}) {
  const { bb, harness } = createFakePluginHost({
    pluginId: "pr-thread-list",
    sdk: {
      plugins: {
        list: async () => ({
          plugins: [{ id: "github-insight", enabled: true, status: "running" }],
        }),
      },
      threads: {
        list:
          options.listThreads ??
          (async () => Object.keys(metadata).map((id) => ({ id, archivedAt: null }))),
        getPluginMetadata: async ({ threadId }: { threadId: string }) => metadata[threadId] ?? {},
      },
    } as never,
  });
  plugin(bb);
  return harness;
}

async function settle() {
  for (let round = 0; round < 5; round++) await new Promise((resolve) => setImmediate(resolve));
}

async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
  await settle();
}

const changes = (harness: Awaited<ReturnType<typeof setup>>) =>
  harness.realtimeSignals.filter((signal) => signal.channel === "summaries.changed");

describe("summary-watch", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("publishes nothing for the first read", async () => {
    const harness = await setup({ thr_1: { prSummary: { version: 1 } } });
    const run = harness.behavior.runService("summary-watch");
    await settle();

    expect(changes(harness)).toEqual([]);
    run.controller.abort();
  });

  it("publishes once for each read that finds a changed, added, or removed summary", async () => {
    const metadata: Metadata = { thr_1: { prSummary: { version: 1, n: 1 } }, thr_2: {} };
    const harness = await setup(metadata);
    const run = harness.behavior.runService("summary-watch");
    await settle();

    metadata.thr_1 = { prSummary: { version: 1, n: 2 } };
    await advance(5_000);
    expect(changes(harness)).toHaveLength(1);

    metadata.thr_2 = { prSummary: { version: 1 } };
    await advance(5_000);
    expect(changes(harness)).toHaveLength(2);

    metadata.thr_1 = {};
    await advance(5_000);
    expect(changes(harness)).toHaveLength(3);
    run.controller.abort();
  });

  it("publishes nothing when a read finds the same summaries", async () => {
    const harness = await setup({ thr_1: { prSummary: { version: 1 } } });
    const run = harness.behavior.runService("summary-watch");
    await settle();

    await advance(15_000);

    expect(changes(harness)).toEqual([]);
    run.controller.abort();
  });

  it("publishes when github-insight becomes unavailable", async () => {
    let enabled = true;
    const { bb, harness } = createFakePluginHost({
      pluginId: "pr-thread-list",
      sdk: {
        plugins: {
          list: async () => ({ plugins: [{ id: "github-insight", enabled, status: "running" }] }),
        },
        threads: {
          list: async () => [{ id: "thr_1", archivedAt: null }],
          getPluginMetadata: async () => ({}),
        },
      } as never,
    });
    plugin(bb);
    const run = harness.behavior.runService("summary-watch");
    await settle();

    enabled = false;
    await advance(5_000);

    expect(changes(harness)).toHaveLength(1);
    run.controller.abort();
  });

  it("keeps the last summaries when a read fails and reads again on the next tick", async () => {
    let fail = false;
    const metadata: Metadata = { thr_1: { prSummary: { version: 1, n: 1 } } };
    const harness = await setup(metadata, {
      listThreads: async () => {
        if (fail) throw new Error("server busy");
        return [{ id: "thr_1", archivedAt: null }];
      },
    });
    const run = harness.behavior.runService("summary-watch");
    await settle();

    fail = true;
    await advance(5_000);
    expect(changes(harness)).toEqual([]);

    fail = false;
    metadata.thr_1 = { prSummary: { version: 1, n: 2 } };
    await advance(5_000);
    expect(changes(harness)).toHaveLength(1);
    run.controller.abort();
  });

  it("stops when aborted while it waits for the next tick", async () => {
    const harness = await setup({});
    const run = harness.behavior.runService("summary-watch");
    await settle();

    run.controller.abort();

    await expect(run.done).resolves.toBeUndefined();
  });

  it("stops when aborted while a read never answers", async () => {
    const harness = await setup({}, { listThreads: () => new Promise(() => {}) });
    const run = harness.behavior.runService("summary-watch");
    await settle();
    let stopped = false;
    void run.done.then(() => (stopped = true));

    run.controller.abort();
    await settle();

    expect(stopped).toBe(true);
  });
});
