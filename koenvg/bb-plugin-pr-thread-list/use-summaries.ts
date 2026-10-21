import { useCallback } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract, Summaries } from "./contract";
import { useLiveRpc } from "./live-rpc";
import { SUMMARY_WRITTEN_CHANNEL } from "./pr-insight";
import { SUMMARIES_CHANGED_CHANNEL } from "./summary-watch";

const POLL_MS = 60_000;

export interface SummariesState extends Summaries {
  loaded: boolean;
}

const INITIAL: SummariesState = { loaded: false, insightAvailable: true, summaries: {} };

function pollAndListen(reload: () => void): () => void {
  const timer = setInterval(reload, POLL_MS);
  const announcements = new BroadcastChannel(SUMMARY_WRITTEN_CHANNEL);
  announcements.onmessage = reload;
  return () => {
    clearInterval(timer);
    announcements.close();
  };
}

export function useSummaries(): SummariesState {
  const rpc = useRpc<typeof rpcContract>();
  const read = useCallback(() => rpc.call("listSummaries", {}), [rpc]);
  const [result] = useLiveRpc(SUMMARIES_CHANGED_CHANNEL, read, pollAndListen);
  return result ? { loaded: true, ...result } : INITIAL;
}
