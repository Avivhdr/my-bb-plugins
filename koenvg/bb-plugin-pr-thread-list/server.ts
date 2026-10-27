import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { rpcContract } from "./contract";
import { MIGRATIONS } from "./migrations";
import { registerParks } from "./parks";
import { registerSnoozes } from "./snoozes";
import { listSummaries } from "./summaries";
import { SUMMARIES_CHANGED_CHANNEL, watchSummaries } from "./summary-watch";

export type { rpcContract } from "./contract";

export default function plugin(bb: BbPluginApi): void {
  bb.storage.migrate(bb.storage.database(), MIGRATIONS);
  bb.rpc.register(rpcContract, {
    listSummaries: () => listSummaries(bb.sdk),
    ...registerSnoozes(bb),
    ...registerParks(bb),
  });
  bb.background.service("summary-watch", {
    start: (signal) =>
      watchSummaries({
        read: () => listSummaries(bb.sdk),
        onChange: () => bb.realtime.publish(SUMMARIES_CHANGED_CHANNEL, {}),
        signal,
      }),
  });
}
