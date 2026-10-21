import { useEffect, useState, useMemo, useId, useRef, useCallback } from "react";
import type { ComponentType } from "react";
import { Button } from "./components/ui/button";
import { IconAction } from "./components/ui/icon-action";
import {
  MarkdownDocument,
  createDocumentModel,
  type LineRequest,
} from "@bb-plugins/markdown-document";
import "@bb-plugins/markdown-document/style.css";
import type { ReaderTarget, ReadResult, TextSnapshot } from "./source";
import { revealInReader } from "./navigation";
import { DestinationProvider, type ResolveDocumentDestinations } from "./destination-view";
import { SelectionAction, type ExcerptDestination } from "./selection";
const NO_DESTINATIONS: import("./destination-types").DestinationRequest[] = [];

export type ReadDocument = (target: ReaderTarget) => Promise<ReadResult>;
export interface ReaderProps {
  target: ReaderTarget;
  readDocument: ReadDocument;
  Original: ComponentType;
  lineRange?: LineRequest;
  resolveDestinations?: ResolveDocumentDestinations;
  destination?: ExcerptDestination;
}

/** The target owner remounts this reader only when source identity changes. */
export function Reader({
  target,
  readDocument,
  Original,
  lineRange,
  resolveDestinations,
  destination,
}: ReaderProps) {
  const [state, setState] = useState<{
    loading: boolean;
    result: ReadResult | null;
    snapshot: TextSnapshot | null;
  }>({ loading: true, result: null, snapshot: null });
  const [view, setView] = useState<"preview" | "raw">(lineRange ? "raw" : "preview");
  const [refresh, setRefresh] = useState(0);
  const [fallback, setFallback] = useState(false);
  const namespace = useId();
  const root = useRef<HTMLElement>(null);
  const [showOutline, setShowOutline] = useState(true);
  const model = useMemo(
    () => (state.snapshot ? createDocumentModel(state.snapshot.text, namespace) : null),
    [state.snapshot, namespace],
  );
  const reveal = useCallback((element: HTMLElement) => {
    if (root.current) revealInReader(root.current, element);
  }, []);
  const navigation = useMemo(() => ({ container: root, reveal }), [reveal]);
  useEffect(() => {
    if (lineRange != null) setView("raw");
  }, [lineRange]);
  useEffect(() => {
    if (fallback) return;
    let current = true;
    setState((previous) => ({ ...previous, loading: true, result: null }));
    const settle = (result: ReadResult) => {
      if (current)
        setState((previous) => ({
          loading: false,
          result,
          snapshot: result.kind === "ready" ? result.snapshot : previous.snapshot,
        }));
    };
    void readDocument(target).then(settle, (cause) =>
      settle({
        kind: "error",
        message:
          cause instanceof Error ? cause.message.slice(0, 1024) : "Could not read this file.",
      }),
    );
    // Every new read invalidates its predecessor. Fallback and unmount also discard results.
    return () => {
      current = false;
    };
  }, [target, readDocument, refresh, fallback]);

  if (fallback) return <Original />;
  const { result, snapshot, loading } = state;
  const path = snapshot?.target.path ?? target.path;
  const filenameStart = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1;
  const filename = path.slice(filenameStart) || path;
  const directory = path.slice(0, filenameStart);
  return (
    <section ref={root} className="markdown-reader" aria-label="Markdown Reader">
      <header className="mr-toolbar">
        <div className="mr-identity" role="group" aria-label={path} title={path}>
          <span className="mr-filename">{filename}</span>
          {directory && <span className="mr-path">{directory}</span>}
        </div>
        <div className="mr-controls" role="group" aria-label="Document controls">
          <div className="mr-view-controls" role="group" aria-label="Document view">
            <IconAction
              icon="Eye"
              label="Preview"
              aria-pressed={view === "preview"}
              onClick={() => setView("preview")}
            />
            <IconAction
              icon="Code"
              label="Raw"
              aria-pressed={view === "raw"}
              onClick={() => setView("raw")}
            />
          </div>
          <div className="mr-reader-actions" role="group" aria-label="Reader actions">
            {view === "preview" && !!model?.headings.length && (
              <IconAction
                icon="ListView"
                label="Outline"
                aria-pressed={showOutline}
                onClick={() => setShowOutline((show) => !show)}
              />
            )}
            <IconAction icon="RotateCcw" label="Refresh" onClick={() => setRefresh((n) => n + 1)} />
          </div>
        </div>
      </header>
      <div className="mr-content">
        <DestinationProvider
          snapshot={snapshot}
          requests={model?.requests ?? NO_DESTINATIONS}
          resolve={resolveDestinations}
          enabled={!loading && result?.kind === "ready"}
        >
          {(destinations) => (
            <>
              {loading && (
                <p className="mr-state" role="status">
                  {snapshot
                    ? "Refreshing Markdown. Showing previous snapshot, not verified current."
                    : "Loading Markdown..."}
                </p>
              )}
              {result && result.kind !== "ready" && (
                <div className="mr-state" role="alert">
                  {snapshot && <p>Refresh failed. Showing stale snapshot.</p>}
                  <p>{result.message}</p>
                  <Button variant="outline" onClick={() => setRefresh((n) => n + 1)}>
                    Retry
                  </Button>
                  <Button variant="outline" onClick={() => setFallback(true)}>
                    Open in BB preview
                  </Button>
                </div>
              )}
              {snapshot &&
                (snapshot.text === "" && view === "preview" ? (
                  <p className="mr-state" role="status">
                    This file is empty.
                  </p>
                ) : (
                  <MarkdownDocument
                    model={model!}
                    view={view}
                    destinations={destinations}
                    outline={showOutline}
                    lineRange={lineRange}
                    annotateSourceLines
                    navigation={navigation}
                  />
                ))}
            </>
          )}
        </DestinationProvider>
      </div>
      <SelectionAction
        panel={root}
        snapshot={!loading && result?.kind === "ready" ? snapshot : null}
        view={view}
        destination={destination}
        revision={refresh}
      />
    </section>
  );
}
