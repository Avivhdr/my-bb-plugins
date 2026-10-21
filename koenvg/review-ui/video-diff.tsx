import { useCallback, useEffect, useRef, useState } from "react";
import type { ImageLabel, ImageResult, ImageSide, ReviewImageDiffProps } from "./image-diff";

type VideoState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; url: string }
  | Exclude<ImageResult, { kind: "ready" }>;
const PLAYBACK_ERROR =
  "Browser could not play this video or codec. Try MP4 with H.264/AAC or WebM with VP8/VP9/Opus, or use a local player.";
const BUTTON =
  "min-h-9 cursor-pointer rounded border border-input px-3 text-foreground hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

export function ReviewVideoDiff({ before, after, active, load }: ReviewImageDiffProps) {
  return (
    <div
      className="px-3 pb-3"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))",
        gap: 12,
      }}
    >
      <VideoFigure
        key={`before:${before?.path}:${before?.revision}`}
        side="before"
        label={before}
        active={active}
        load={load}
      />
      <VideoFigure
        key={`after:${after?.path}:${after?.revision}`}
        side="after"
        label={after}
        active={active}
        load={load}
      />
    </div>
  );
}

function VideoFigure({
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
  const [state, setState] = useState<VideoState>({ kind: "idle" });
  const [request, setRequest] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const release = useRef<() => void>(() => {});
  const attach = useCallback((node: HTMLVideoElement | null) => {
    video.current?.pause();
    video.current = node;
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let url: string | null = null;
    release.current = () => {
      if (url !== null) URL.revokeObjectURL(url);
      url = null;
    };
    setState({ kind: "idle" });
    if (active && label && request > 0) {
      setState({ kind: "loading" });
      void load(side, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return;
          if (result.kind !== "ready") {
            setState(result);
            return;
          }
          if (!document.createElement("video").canPlayType(result.blob.type)) {
            setState({ kind: "error", code: "decode", message: PLAYBACK_ERROR });
            return;
          }
          url = URL.createObjectURL(result.blob);
          setState({ kind: "ready", url });
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setState({
              kind: "error",
              code: "read",
              message: "Could not load video. Retry or use a local player.",
            });
        });
    }
    if (!active) setRequest(0);
    return () => {
      controller.abort();
      release.current();
    };
  }, [active, label?.path, label?.revision, side, load, request]);
  const title = side === "before" ? "Before" : "After";
  const shown = active ? state : { kind: "idle" as const };
  return (
    <figure className="m-0 min-w-0 text-xs">
      <figcaption className="flex flex-col gap-1 py-2" style={{ minHeight: 68 }}>
        <span className="font-medium">{title}</span>
        {label && (
          <>
            <span className="break-all text-muted-foreground">{label.path}</span>
            <span className="break-all text-muted-foreground">{label.revision}</span>
          </>
        )}
      </figcaption>
      <div
        className="flex flex-col items-center justify-center gap-3 overflow-hidden rounded border border-border bg-background p-3 text-muted-foreground"
        style={{ minHeight: 240 }}
      >
        {label === null || shown.kind === "absent" ? (
          <span>Not present</span>
        ) : shown.kind === "ready" ? (
          <>
            <video
              ref={attach}
              aria-label={`${title}: ${label.path} (${label.revision})`}
              src={shown.url}
              controls
              playsInline
              preload="none"
              style={{ width: "100%", maxHeight: 320, objectFit: "contain" }}
              onError={() => {
                video.current?.pause();
                release.current();
                setState({ kind: "error", code: "decode", message: PLAYBACK_ERROR });
              }}
            />
            <button type="button" className={BUTTON} onClick={() => setRequest(0)}>
              Unload {side} video
            </button>
          </>
        ) : shown.kind === "loading" ? (
          <>
            <span role="status">Loading video…</span>
            <button type="button" className={BUTTON} onClick={() => setRequest(0)}>
              Cancel {side} video
            </button>
          </>
        ) : (
          <>
            {shown.kind === "error" ? (
              <span role="alert" className="break-words text-destructive">
                {shown.message}
              </span>
            ) : (
              <span className="text-center">
                MP4 or WebM. Load up to 8 MiB per side. Playback starts only when you press Play.
              </span>
            )}
            <button
              type="button"
              className={BUTTON}
              disabled={!active}
              onClick={() => setRequest((value) => value + 1)}
            >
              {shown.kind === "error" ? "Retry" : "Load"} {side} video
            </button>
          </>
        )}
      </div>
    </figure>
  );
}
