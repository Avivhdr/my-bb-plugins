import type { ComponentType } from "react";
import type { PluginBrowserBbSdk } from "@get-bb/plugin-sdk/app";
import { renderSlot, type RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";

type ActionCall = { method: string; threadId?: string; [key: string]: unknown };

/** Native registry and navigation fixtures. No host confirmation or mutation is emulated. */
export function renderSidebarSlot<Props extends object>(
  registration: { component: ComponentType<Props> },
  props: Props,
  options: RenderSlotOptions = {},
) {
  const calls: ActionCall[] = [];
  const slot = renderSlot(registration, props, {
    ...options,
    sdk: {
      ...options.sdk,
      threads: {
        ...options.sdk?.threads,
        update:
          options.sdk?.threads?.update ??
          (async () => ({}) as Awaited<ReturnType<PluginBrowserBbSdk["threads"]["update"]>>),
      },
    },
    threadActions:
      options.threadActions ??
      ((thread) =>
        [
          ["pin", "setPinned", { pinned: thread.pinnedAt === null }],
          ["read", "setRead", { read: thread.isUnread }],
          ["archive", "archive", {}],
          ["delete", "requestDelete", {}],
        ].map(([id, method, fields]) => ({
          key: `bb--core/${id}`,
          pluginId: "bb--core",
          group: "",
          action: {
            label: String(id),
            icon: "Pin" as const,
            run: async () => {
              calls.push({ method: String(method), threadId: thread.id, ...(fields as object) });
            },
          },
        }))),
  });
  return {
    ...slot,
    inspection: {
      ...slot.inspection,
      get threadActionCalls(): ActionCall[] {
        const navigation = slot.navigateCalls.flatMap((call): ActionCall[] => {
          if (call.method === "toThread")
            return [
              {
                method: "open",
                threadId: call.threadId,
                ...(call.options === undefined ? {} : { options: call.options }),
              },
            ];
          if (call.method === "toCompose") {
            const { placement, ...scope } = call.options ?? {};
            return [
              {
                method: "openNewThread",
                options: {
                  ...scope,
                  ...(placement?.sectionId ? { sectionId: placement.sectionId } : {}),
                },
              },
            ];
          }
          return [];
        });
        const renames = slot.sdkCalls.flatMap((call): ActionCall[] => {
          const input = call.args[0] as { threadId?: string; title?: string } | undefined;
          return call.method === "threads.update" && typeof input?.title === "string"
            ? [{ method: "rename", threadId: input.threadId, title: input.title }]
            : [];
        });
        return [...calls, ...navigation, ...renames];
      },
    },
  };
}
