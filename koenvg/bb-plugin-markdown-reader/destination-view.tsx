import { useEffect, useState, type ReactNode } from "react";
import { experimental_FileLink as FileLink, UrlLink } from "@get-bb/plugin-sdk/app";
import { localDestinations, type DestinationPolicy } from "@bb-plugins/markdown-document";
import type { TextSnapshot } from "./source";
import {
  destinationKey,
  type Destination,
  type DestinationRequest,
  type DestinationResult,
} from "./destination-types";

export type ResolveDocumentDestinations = (
  target: TextSnapshot["target"],
  requests: DestinationRequest[],
) => Promise<DestinationResult>;

/** One resolution per loaded snapshot. View changes reuse its image URLs. */
export function DestinationProvider({
  snapshot,
  requests,
  resolve,
  enabled,
  children,
}: {
  snapshot: TextSnapshot | null;
  requests: readonly DestinationRequest[];
  resolve?: ResolveDocumentDestinations;
  enabled: boolean;
  children: (policy: DestinationPolicy) => ReactNode;
}) {
  const [state, setState] = useState<{
    snapshot: TextSnapshot;
    results: Map<string, Destination>;
  } | null>(null);
  useEffect(() => {
    if (!snapshot || !resolve || !requests.length || !enabled) return;
    let current = true;
    void resolve(
      snapshot.target,
      requests.map((request) => ({ ...request })),
    ).then(
      (result) => {
        if (!current) return;
        const identity = result.identity;
        if (
          !identity ||
          identity.hostId !== snapshot.hostId ||
          identity.rootPath !== snapshot.rootPath ||
          identity.documentPath !== snapshot.documentPath
        )
          return;
        setState({
          snapshot,
          results: new Map(
            requests.map((request, i) => [
              destinationKey(request),
              result.destinations[i] ?? { kind: "rejected", reason: "Destination unavailable." },
            ]),
          ),
        });
      },
      () => {
        /* Readable links/alt text remain inert. Refresh retries the source. */
      },
    );
    // Ignore late results after source changes, fallback, or unmount.
    return () => {
      current = false;
    };
  }, [snapshot, requests, resolve, enabled]);
  if (!enabled || state?.snapshot !== snapshot) return children(localDestinations);
  const policy: DestinationPolicy = {
    kind: "delegated",
    resolve(request) {
      const result = state.results.get(destinationKey(request));
      if (!result) return undefined;
      if (result.kind === "rejected") return result;
      if (request.image) {
        if (result.kind !== "image") return undefined;
        if (
          !result.remote &&
          !/^\/api\/v1\/plugins\/markdown-reader\/http\/image\?asset=[a-z\d_-]+$/i.test(result.url)
        )
          return undefined;
        return { kind: "image", url: result.url, source: result.remote ? "remote" : "source" };
      }
      if (result.kind === "fragment") return result;
      if (result.kind === "external-url")
        return { kind: "bound-link", render: (props) => <UrlLink {...props} href={result.url} /> };
      if (result.kind === "local-file")
        return {
          kind: "bound-link",
          render: (props) => (
            <FileLink {...props} target={result.target} data-source-host={result.hostId} />
          ),
        };
      return undefined;
    },
  };
  return children(policy);
}
