import { useEffect } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { receivePrPanel } from "../pr-panel-navigation";
import { postIntent } from "./command-intents";

type BbNavigate = ReturnType<typeof useBbNavigate>;

export function openPrOverview(navigate: BbNavigate, threadId: string): boolean {
  const opened = navigate.openThreadPanel({ actionId: "pr" });
  if (opened) postIntent(threadId, "pr", "show-overview");
  return opened;
}

export function usePrPanelNavigation(threadId: string): void {
  const navigate = useBbNavigate();
  useEffect(() => {
    let disposed = false;
    let dispose: (() => void) | undefined;
    // Parent host effects reset the compact drawer on thread changes. Open after
    // they finish, otherwise that reset hides a successfully selected PR tab.
    queueMicrotask(() => {
      if (!disposed) dispose = receivePrPanel(threadId, () => openPrOverview(navigate, threadId));
    });
    return () => {
      disposed = true;
      dispose?.();
    };
  }, [threadId, navigate]);
}
