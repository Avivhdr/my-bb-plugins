import { useEffect, useRef, useState } from "react";

export type ImageSide = "before" | "after";
export type ImageLabel = { path: string; revision: string };
export type ImageResult =
  | { kind: "ready"; blob: Blob }
  | { kind: "absent" }
  | {
      kind: "error";
      code: "unsupported" | "too_large" | "read" | "stale" | "decode" | "auth" | "missing";
      message: string;
    };
type ImageState =
  | { kind: "loading" }
  | { kind: "ready"; url: string }
  | Exclude<ImageResult, { kind: "ready" }>;
export interface ReviewImageDiffProps {
  before: ImageLabel | null;
  after: ImageLabel | null;
  active: boolean;
  load: (side: ImageSide, signal: AbortSignal) => Promise<ImageResult>;
}

export function ReviewImageDiff({ before, after, active, load }: ReviewImageDiffProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => setNear(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: "800px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className="px-3 pb-3"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))",
        gap: 12,
      }}
    >
      <ImageFigure side="before" label={before} active={active && near} load={load} />
      <ImageFigure side="after" label={after} active={active && near} load={load} />
    </div>
  );
}

function ImageFigure({
  side,
  label,
  active,
  load,
}: {
  side: ImageSide;
  label: ImageLabel | null;
  active: boolean;
  load: ReviewImageDiffProps["load"];
}) {
  const [state, setState] = useState<ImageState>({ kind: "loading" });
  const [retry, setRetry] = useState(0);
  const url = useRef<string | null>(null);
  const path = label?.path;
  const revision = label?.revision;
  useEffect(() => {
    const controller = new AbortController();
    function release() {
      if (url.current !== null) URL.revokeObjectURL(url.current);
      url.current = null;
    }
    setState({ kind: "loading" });
    if (active && path !== undefined) {
      void load(side, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return;
          if (result.kind === "ready") {
            url.current = URL.createObjectURL(result.blob);
            setState({ kind: "ready", url: url.current });
          } else setState(result);
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setState({ kind: "error", code: "read", message: "Could not load image" });
        });
    }
    return () => {
      controller.abort();
      release();
    };
  }, [side, path, revision, active, load, retry]);
  const title = side === "before" ? "Before" : "After";
  const shown = active ? state : { kind: "loading" as const };
  return (
    <figure className="m-0 min-w-0 text-xs">
      <figcaption className="flex flex-col gap-1 py-2" style={{ minHeight: 68 }}>
        <span className="font-medium">{title}</span>
        {label && (
          <span className="break-all text-muted-foreground" title={label.path}>
            {label.revision}
          </span>
        )}
      </figcaption>
      <div
        className="flex items-center justify-center overflow-hidden rounded border border-border bg-background text-muted-foreground"
        style={{
          height: 240,
          backgroundImage:
            "conic-gradient(var(--muted) 25%, transparent 0 50%, var(--muted) 0 75%, transparent 0)",
          backgroundSize: "16px 16px",
        }}
      >
        {label === null || shown.kind === "absent" ? (
          <span>Not present</span>
        ) : shown.kind === "loading" ? (
          <span role="status">{active ? "Loading image…" : "Image preview paused"}</span>
        ) : shown.kind === "error" ? (
          <div className="flex max-w-full flex-col items-center gap-2 bg-background p-3 text-center">
            <span role="alert" className="text-destructive">
              {shown.message}
            </span>
            <button
              type="button"
              className="h-9 cursor-pointer rounded border border-input px-3 text-foreground hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setRetry((value) => value + 1)}
            >
              Retry {side}
            </button>
          </div>
        ) : (
          <img
            src={shown.url}
            alt={`${title}: ${label.path} (${label.revision})`}
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
            onError={() => {
              if (url.current !== null) URL.revokeObjectURL(url.current);
              url.current = null;
              setState({
                kind: "error",
                code: "decode",
                message: "Browser could not decode this image",
              });
            }}
          />
        )}
      </div>
    </figure>
  );
}

export function imageBlobResult(
  result:
    | { kind: "ready"; content: string; mime: string }
    | Exclude<ImageResult, { kind: "ready" }>,
): ImageResult {
  if (result.kind !== "ready") return result;
  const bytes = Uint8Array.from(atob(result.content), (character) => character.charCodeAt(0));
  return { kind: "ready", blob: new Blob([bytes], { type: result.mime }) };
}
