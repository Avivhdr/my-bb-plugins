// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { thread } from "./fixtures";
import { useThreadListActions } from "./sidebar-actions";

afterEach(cleanup);

function DeleteControl() {
  const actions = useThreadListActions(thread());
  const [error, setError] = useState("");
  return (
    <>
      <button
        onClick={async () => {
          try {
            await actions.requestDelete();
          } catch (error) {
            setError(error instanceof Error ? error.message : String(error));
          }
        }}
      >
        Delete
      </button>
      <span role="alert">{error}</span>
    </>
  );
}

it.each(["missing", "disabled"])("does not invoke %s native delete actions", async (state) => {
  const run = vi.fn(async () => {});
  const slot = renderSlot(
    { component: DeleteControl },
    {},
    {
      threadActions: () =>
        state === "missing"
          ? []
          : [
              {
                key: "bb--core/delete",
                pluginId: "bb--core",
                group: "lifecycle",
                action: { label: "Delete", icon: "Trash2", disabled: true, run },
              },
            ],
    },
  );
  fireEvent.click(slot.getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(slot.getByRole("alert").textContent).toContain("unavailable"));
  expect(run).not.toHaveBeenCalled();

  expect(slot.inspection.sdkCalls).toEqual([]);
});

it("delegates deletion to the row-bound host action, not a direct SDK mutation", async () => {
  const run = vi.fn(async () => {});
  const resolve = vi.fn((_target: import("@get-bb/plugin-sdk/app").PluginThreadActionTarget) => [
    {
      key: "bb--core/delete",
      pluginId: "bb--core",
      group: "lifecycle",
      action: { label: "Delete", icon: "Trash2" as const, run },
    },
  ]);
  const slot = renderSlot({ component: DeleteControl }, {}, { threadActions: resolve });
  fireEvent.click(slot.getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(run).toHaveBeenCalledOnce());
  expect(resolve.mock.calls[0]?.[0]).toMatchObject({ id: "t1", projectId: "p1" });
  expect(slot.inspection.sdkCalls).toEqual([]);
});
