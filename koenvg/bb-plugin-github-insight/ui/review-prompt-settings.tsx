import { useEffect, useId, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { ReviewInstructions, rpcContract } from "../contract";
import {
  buildReviewPrompt,
  DEFAULT_REVIEW_INSTRUCTIONS,
  REVIEW_PROMPT_PLACEHOLDERS,
} from "../core/review-prompt";
import { cn } from "@/lib/utils";
import { PRIMARY_BUTTON, QUIET_BUTTON, TEXTAREA } from "./controls";
import { messageOf } from "./error-message";

const SAMPLE_PR = {
  number: 123,
  title: "Add rate limits",
  url: "https://github.com/acme/api/pull/123",
  repo: "acme/api",
};

type Status = { kind: "idle" } | { kind: "saved" } | { kind: "error"; message: string };

/** Edits the "How to review" part of the prompt that Start review fills in. */
export function ReviewPromptSettings() {
  const rpc = useRpc<typeof rpcContract>();
  const id = useId();
  const [saved, setSaved] = useState<ReviewInstructions | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  useEffect(() => {
    let current = true;
    rpc.call("getReviewInstructions", {}).then(
      (loaded) => {
        if (!current) return;
        setSaved(loaded);
        setDraft(loaded.instructions);
      },
      (failure: unknown) => current && setStatus({ kind: "error", message: messageOf(failure) }),
    );
    return () => {
      current = false;
    };
  }, [rpc]);

  async function save(instructions: string | null) {
    setBusy(true);
    setStatus({ kind: "idle" });
    try {
      const result = await rpc.call("setReviewInstructions", { instructions });
      if (result.kind === "error") {
        setStatus({ kind: "error", message: result.message });
        return;
      }
      const next = instructions ?? DEFAULT_REVIEW_INSTRUCTIONS;
      setSaved({ instructions: next.trim(), isDefault: instructions === null });
      setDraft(next.trim());
      setStatus({ kind: "saved" });
    } catch (failure) {
      setStatus({ kind: "error", message: messageOf(failure) });
    } finally {
      setBusy(false);
    }
  }

  if (saved === null) {
    return (
      <p className="text-xs text-muted-foreground">
        {status.kind === "error" ? `Could not read the prompt: ${status.message}` : "Loading…"}
      </p>
    );
  }

  const blank = draft.trim() === "";
  const changed = draft.trim() !== saved.instructions;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        How to review. Start review puts this under "How to review" in the prompt. The checkout, the
        draft commands, and the rule against posting to GitHub are always added. Placeholders:{" "}
        {REVIEW_PROMPT_PLACEHOLDERS.map((placeholder, index) => (
          <span key={placeholder}>
            {index > 0 && ", "}
            <code className="font-mono">{placeholder}</code>
          </span>
        ))}
        .
      </label>
      <textarea
        id={id}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setStatus({ kind: "idle" });
        }}
        rows={8}
        className={cn(TEXTAREA, "max-h-96 min-h-40 font-mono text-xs")}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={PRIMARY_BUTTON}
          disabled={busy || blank || !changed}
          onClick={() => void save(draft)}
        >
          Save
        </button>
        <button
          type="button"
          className={QUIET_BUTTON}
          disabled={busy || (saved.isDefault && draft.trim() === DEFAULT_REVIEW_INSTRUCTIONS)}
          onClick={() => void save(null)}
        >
          Reset to default
        </button>
        <span role="status" className="text-xs text-muted-foreground">
          {status.kind === "saved" && "Saved. The next review uses it."}
          {status.kind === "error" && (
            <span className="text-destructive">Could not save: {status.message}</span>
          )}
          {status.kind === "idle" && blank && "The instructions cannot be empty."}
        </span>
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">Preview the full prompt</summary>
        <pre className="mt-2 whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-3 font-mono">
          {buildReviewPrompt(SAMPLE_PR, blank ? saved.instructions : draft)}
        </pre>
      </details>
    </div>
  );
}
