import { useEffect, useId, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { AutoReviewSettings as Settings, rpcContract } from "../contract";
import { messageOf } from "./error-message";

const LIMITS = [1, 2, 3, 4, 5, 6];

type Status = { kind: "idle" } | { kind: "saving" } | { kind: "error"; message: string };

/** Turns auto-review on or off and sets how many review threads may work at once. */
export function AutoReviewSettings() {
  const rpc = useRpc<typeof rpcContract>();
  const limitId = useId();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  useEffect(() => {
    let current = true;
    rpc.call("getAutoReview", {}).then(
      (loaded) => current && setSettings(loaded),
      (failure: unknown) => current && setStatus({ kind: "error", message: messageOf(failure) }),
    );
    return () => {
      current = false;
    };
  }, [rpc]);

  async function save(next: Settings) {
    const previous = settings;
    setSettings(next);
    setStatus({ kind: "saving" });
    try {
      const result = await rpc.call("setAutoReview", next);
      if (result.kind === "error") throw new Error(result.message);
      setStatus({ kind: "idle" });
    } catch (failure) {
      setSettings(previous);
      setStatus({ kind: "error", message: messageOf(failure) });
    }
  }

  if (settings === null) {
    return (
      <p className="text-xs text-muted-foreground">
        {status.kind === "error" ? `Could not read the setting: ${status.message}` : "Loading…"}
      </p>
    );
  }

  const limits = LIMITS.includes(settings.maxRunning)
    ? LIMITS
    : [...LIMITS, settings.maxRunning].sort((a, b) => a - b);
  return (
    <div className="flex flex-col gap-3 text-sm">
      <label className="flex cursor-pointer select-none items-center gap-2">
        <input
          type="checkbox"
          className="peer sr-only"
          checked={settings.enabled}
          disabled={status.kind === "saving"}
          onChange={(event) => void save({ ...settings, enabled: event.target.checked })}
        />
        <span
          aria-hidden
          className="relative h-4 w-7 shrink-0 rounded-full bg-muted-foreground/25 transition-colors duration-200 after:absolute after:left-0.5 after:top-0.5 after:size-3 after:rounded-full after:bg-background after:shadow-[0_1px_2px_rgb(0_0_0/0.2)] after:transition-transform after:duration-200 after:ease-out peer-checked:bg-primary peer-checked:after:translate-x-3 peer-focus-visible:ring-2 peer-focus-visible:ring-ring/50"
        />
        Start reviews on their own for Direct and Teammates PRs
      </label>
      <div className="flex items-center gap-2">
        <label htmlFor={limitId}>Review threads working at once, at most</label>
        <select
          id={limitId}
          value={settings.maxRunning}
          disabled={status.kind === "saving"}
          onChange={(event) => void save({ ...settings, maxRunning: Number(event.target.value) })}
          className="h-7 rounded-md border border-border bg-background px-2 text-xs tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {limits.map((limit) => (
            <option key={limit} value={limit}>
              {limit}
            </option>
          ))}
        </select>
      </div>
      <p className="text-xs text-muted-foreground">
        Each PR starts once, oldest first, in a new worktree with the review prompt below. Review
        threads you start yourself count toward the limit. A thread that waits for your answer does
        not. Skipped, ignored, and reviewed PRs and PRs that already have a thread stay out.
      </p>
      {status.kind === "error" && (
        <p role="alert" className="text-xs text-destructive">
          Could not save: {status.message}
        </p>
      )}
    </div>
  );
}
