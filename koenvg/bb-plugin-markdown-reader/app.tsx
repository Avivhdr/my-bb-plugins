import { useCallback, useMemo } from "react";
import {
  definePluginApp,
  useComposer,
  useRpc,
  type PluginFileOpenerProps,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import { Reader, type ReadDocument } from "./reader";
import type { ExcerptDestination } from "./selection";
import "./app.css";

function FileReader({ path, source, Original, experimental_lineRange }: PluginFileOpenerProps) {
  const composer = useComposer();
  const destination = useMemo<ExcerptDestination>(
    () => ({
      key: composer.key,
      available: composer.scope.kind === "thread" || composer.scope.kind === "new-thread",
      append: (quote) => {
        try {
          composer.insert(quote, { at: "end", block: true });
        } catch {
          return "Could not add the selection. Check the associated chat draft and select the text again to retry.";
        }
        try {
          composer.focus();
        } catch {
          return "Selection added to the draft. Open the associated chat to continue.";
        }
        return null;
      },
    }),
    [composer, composer.key, composer.scope.kind],
  );
  const { kind, threadId, environmentId, projectId, experimental_hostId } = source;
  const target = useMemo(
    () => ({
      path,
      source: {
        kind,
        threadId,
        environmentId,
        projectId,
        ...(experimental_hostId === undefined ? {} : { experimental_hostId }),
      },
    }),
    [path, kind, threadId, environmentId, projectId, experimental_hostId],
  );
  const rpc = useRpc<typeof rpcContract>();
  const readDocument = useCallback<ReadDocument>(
    (target) => rpc.call("read_document", target),
    [rpc],
  );
  const resolveDestinations = useCallback<import("./destination-view").ResolveDocumentDestinations>(
    (target, requests) => rpc.call("resolve_destinations", { target, requests }),
    [rpc],
  );
  return (
    <Reader
      key={JSON.stringify(target)}
      target={target}
      destination={destination}
      readDocument={readDocument}
      resolveDestinations={resolveDestinations}
      Original={Original}
      lineRange={experimental_lineRange}
    />
  );
}

export default definePluginApp((app) => {
  app.slots.fileOpener({
    id: "markdown-reader",
    title: "Markdown Reader",
    extensions: ["md", "markdown"],
    component: FileReader,
  });
});
