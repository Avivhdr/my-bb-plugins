import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { loadAttributionSource } from "./src/bbAttribution";
import { MIGRATIONS } from "./src/database";
import { withRememberedEnvironments } from "./src/environmentStore";
import { nodeTranscriptFileSystem } from "./src/nodeFileSystem";
import { runRescanLoop } from "./src/rescanLoop";
import { createRpcHandlers, rpcContract } from "./src/rpc";
import { resolveTranscriptRoot } from "./src/scanner";
import { SETTINGS } from "./src/settings";
import { createSpendService } from "./src/spendService";

export type { rpcContract } from "./src/rpc";

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define(SETTINGS);
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);

  const onError = (message: string, error: unknown) =>
    bb.log.warn(`${message}: ${error instanceof Error ? error.message : String(error)}`);

  const service = createSpendService({
    db,
    fs: nodeTranscriptFileSystem,
    root: resolveTranscriptRoot(),
    loadAttributionSource: async () =>
      withRememberedEnvironments(db, await loadAttributionSource(bb.sdk)),
    now: () => Date.now(),
    onError,
  });

  bb.rpc.register(rpcContract, createRpcHandlers(service));

  bb.background.service("spend-index", {
    start: (signal) =>
      runRescanLoop({
        signal,
        readMinutes: async () => (await settings.get()).rescanMinutes,
        scan: (scanSignal) => service.refresh(scanSignal),
        onError,
      }),
  });
}
