// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, waitFor } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { createSnoozeClient, SnoozeOwner } from "./snooze-client";
import { thread, snoozeSnapshot, archivedReady } from "./fixtures";

afterEach(cleanup);

it("owns one snooze reader, clears controls on cleanup, and ignores old generation responses", async () => {
  const client = createSnoozeClient();
  let finish!: (value: ReturnType<typeof snoozeSnapshot>) => void;
  const pending = new Promise<ReturnType<typeof snoozeSnapshot>>((resolve) => {
    finish = resolve;
  });
  const mount = (listSnoozes: () => unknown) =>
    renderSlot(
      { component: () => <SnoozeOwner client={client} /> },
      {},
      {
        sidebarThreads: { threads: [thread()], experimental_archived: archivedReady },
        rpc: { listSnoozes, snooze: () => ({}), wake: () => ({}) },
      },
    );
  const first = mount(() => pending);
  expect(client.getSnapshot().snoozesReady).toBe(false);
  expect(first.inspection.rpcCalls).toHaveLength(1);
  first.lifecycle.unmount();
  expect(client.getSnapshot().controls).toBeNull();
  const second = mount(() => snoozeSnapshot());
  await waitFor(() => expect(client.getSnapshot().snoozesReady).toBe(true));
  await act(async () => finish(snoozeSnapshot({ t1: Date.now() + 100_000 })));
  expect(client.getSnapshot().snoozes).toEqual({});
  const retained = client.getSnapshot().controls!;
  second.lifecycle.unmount();
  await act(async () => {
    await retained.snooze("t1", Date.now() + 100_000);
    await retained.wake("t1");
  });
  await second.behavior.emitRealtime("snoozes.changed", {});
  expect(second.inspection.rpcCalls).toHaveLength(1);
  expect(client.getSnapshot().threadsReady).toBe(false);
});

it("keeps one early-wake operation in flight across realtime refreshes", async () => {
  const client = createSnoozeClient();
  const wake = vi.fn(() => new Promise(() => {}));
  const slot = renderSlot(
    { component: () => <SnoozeOwner client={client} /> },
    {},
    {
      sidebarThreads: {
        threads: [thread({ hasPendingInteraction: true })],
        experimental_archived: archivedReady,
      },
      rpc: { listSnoozes: () => snoozeSnapshot({ t1: Date.now() + 100_000 }), wake },
    },
  );
  await waitFor(() => expect(wake).toHaveBeenCalledOnce());
  await slot.behavior.emitRealtime("snoozes.changed", {});
  expect(wake).toHaveBeenCalledOnce();
  expect(slot.inspection.rpcCalls.filter(({ method }) => method === "listSnoozes")).toHaveLength(2);
});

it("keeps the full group's effective state awake with one request while multiple members need attention", async () => {
  const client = createSnoozeClient();
  const wake = vi.fn(() => new Promise(() => {}));
  const later = Date.now() + 100_000;
  const slot = renderSlot(
    { component: () => <SnoozeOwner client={client} /> },
    {},
    {
      sidebarThreads: {
        experimental_archived: archivedReady,
        threads: [
          thread({ id: "parent", queuedWork: "failed" }),
          thread({ id: "child", parentThreadId: "parent", hasPendingInteraction: true }),
          thread({ id: "quiet", parentThreadId: "parent" }),
        ],
      },
      rpc: {
        listSnoozes: () =>
          snoozeSnapshot(
            { parent: later, child: later, quiet: later },
            { parent: "g", child: "g", quiet: "g" },
          ),
        wake,
      },
    },
  );
  await waitFor(() => expect(wake).toHaveBeenCalledOnce());
  expect(client.getSnapshot().controls!.snoozed.size).toBe(0);
  await slot.behavior.emitRealtime("snoozes.changed", {});
  expect(wake).toHaveBeenCalledOnce();
});

it("fails closed when a server snapshot is missing group membership", async () => {
  const client = createSnoozeClient();
  const snooze = vi.fn();
  const slot = renderSlot(
    { component: () => <SnoozeOwner client={client} /> },
    {},
    {
      sidebarThreads: { threads: [thread()], experimental_archived: archivedReady },
      rpc: { listSnoozes: () => ({ snoozes: {} }), snooze },
    },
  );
  await act(async () => {});
  expect(client.getSnapshot().snoozesReady).toBe(false);
  expect(client.getSnapshot().controls!.canSnooze("t1")).toBe(false);
  await act(async () => {
    await client.getSnapshot().controls!.snooze("t1", Date.now() + 100_000);
  });
  expect(snooze).not.toHaveBeenCalled();
  slot.lifecycle.unmount();
});

it("retries a failed group wake on the next realtime refresh", async () => {
  const client = createSnoozeClient();
  const wake = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({});
  const later = Date.now() + 100_000;
  const slot = renderSlot(
    { component: () => <SnoozeOwner client={client} /> },
    {},
    {
      sidebarThreads: {
        threads: [thread({ id: "child", hasPendingInteraction: true })],
        experimental_archived: archivedReady,
      },
      rpc: { listSnoozes: () => snoozeSnapshot({ child: later }, { child: "g" }), wake },
    },
  );
  await waitFor(() => expect(wake).toHaveBeenCalledOnce());
  await slot.behavior.emitRealtime("snoozes.changed", {});
  await waitFor(() => expect(wake).toHaveBeenCalledTimes(2));
});

it.each([
  null,
  { ...archivedReady, status: "loading" as const },
  { ...archivedReady, hasNextPage: true },
  { ...archivedReady, isFetchNextPageError: true },
])("blocks mutations with incomplete archived relationship data: %j", async (archived) => {
  const client = createSnoozeClient(),
    snooze = vi.fn();
  renderSlot(
    { component: () => <SnoozeOwner client={client} /> },
    {},
    {
      sidebarThreads: { threads: [thread()], experimental_archived: archived },
      rpc: { listSnoozes: () => snoozeSnapshot(), snooze },
    },
  );
  await waitFor(() => expect(client.getSnapshot().snoozesReady).toBe(true));
  expect(client.getSnapshot().threadsReady).toBe(false);
  await client.getSnapshot().controls!.snooze("t1", Date.now() + 100_000);
  expect(snooze).not.toHaveBeenCalled();
});

it("loads additional archived pages for complete descendant eligibility", async () => {
  const client = createSnoozeClient(),
    fetchNextPage = vi.fn().mockResolvedValue(undefined);
  renderSlot(
    { component: () => <SnoozeOwner client={client} /> },
    {},
    {
      sidebarThreads: {
        threads: [thread()],
        experimental_archived: { ...archivedReady, hasNextPage: true, fetchNextPage },
      },
      rpc: { listSnoozes: () => snoozeSnapshot() },
    },
  );
  await waitFor(() => expect(fetchNextPage).toHaveBeenCalledOnce());
  expect(client.getSnapshot().threadsReady).toBe(false);
});
