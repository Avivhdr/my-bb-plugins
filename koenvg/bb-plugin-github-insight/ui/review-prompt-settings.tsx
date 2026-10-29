import { useEffect, useId, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { InstructionsPrompt, ReviewInstructions, rpcContract } from "../contract";
import {
  DEFAULT_RE_REVIEW_INSTRUCTIONS,
  DEFAULT_REVIEW_INSTRUCTIONS,
  reReviewPromptHead,
  REVIEW_PROMPT_PLACEHOLDERS,
  reviewPromptHead,
} from "../core/review-prompt";
import { cn } from "@/lib/utils";
import { PRIMARY_BUTTON, QUIET_BUTTON } from "./controls";
import { messageOf } from "./error-message";

const SAMPLE_PR = {
  number: 123,
  title: "Add rate limits",
  url: "https://github.com/acme/api/pull/123",
  repo: "acme/api",
};

const SAMPLE_BASIS = {
  reviewedOid: "3f2a9c1e7b4d",
  reviewedAt: Date.parse("2026-10-07T08:30:00Z"),
};

type Status = { kind: "idle" } | { kind: "saved" } | { kind: "error"; message: string };

interface PromptConfig {
  prompt: InstructionsPrompt;
  defaults: string;
  savedText: string;
  /** The part the plugin writes, for the example PR. */
  head: string;
}

const REVIEW: PromptConfig = {
  prompt: "review",
  defaults: DEFAULT_REVIEW_INSTRUCTIONS,
  savedText: "Saved. The next review uses it.",
  head: reviewPromptHead(SAMPLE_PR),
};

const RE_REVIEW: PromptConfig = {
  prompt: "re-review",
  defaults: DEFAULT_RE_REVIEW_INSTRUCTIONS,
  savedText: "Saved. The next re-review uses it.",
  head: reReviewPromptHead(SAMPLE_PR, SAMPLE_BASIS),
};

const BAR = "flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-1.5 text-xs";

/** The whole prompt that Start review fills in, with its editable part after the Steps. */
export function ReviewPromptSettings() {
  return <PromptSettings config={REVIEW} />;
}

/** The whole prompt that Re-review sends, with its editable part after the Steps. */
export function ReReviewPromptSettings() {
  return <PromptSettings config={RE_REVIEW} />;
}

function PromptSettings({ config }: { config: PromptConfig }) {
  const { prompt, defaults } = config;
  const rpc = useRpc<typeof rpcContract>();
  const id = useId();
  const [saved, setSaved] = useState<ReviewInstructions | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  useEffect(() => {
    let current = true;
    rpc.call("getReviewInstructions", { prompt }).then(
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
  }, [rpc, prompt]);

  async function save(instructions: string | null) {
    setBusy(true);
    setStatus({ kind: "idle" });
    try {
      const result = await rpc.call("setReviewInstructions", { instructions, prompt });
      if (result.kind === "error") {
        setStatus({ kind: "error", message: result.message });
        return;
      }
      const next = instructions ?? defaults;
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
      <div className="overflow-hidden rounded-md border border-border">
        <section aria-label="Set by the plugin" className="bg-muted/40">
          <div className={cn(BAR, "border-b border-border text-muted-foreground")}>
            <span className="font-medium">Set by the plugin</span>
            <span>Shown for an example PR. Real values are filled in for each PR.</span>
          </div>
          <pre
            data-testid="prompt-head"
            className="whitespace-pre-wrap p-3 font-mono text-xs text-muted-foreground"
          >
            {config.head}
          </pre>
        </section>
        <div className={cn(BAR, "border-y border-border")}>
          <label htmlFor={id} className="font-medium">
            Yours to edit
          </label>
          <span className="text-muted-foreground">
            Placeholders:{" "}
            {REVIEW_PROMPT_PLACEHOLDERS.map((placeholder, index) => (
              <span key={placeholder}>
                {index > 0 && ", "}
                <code className="font-mono">{placeholder}</code>
              </span>
            ))}
          </span>
        </div>
        <textarea
          id={id}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setStatus({ kind: "idle" });
          }}
          spellCheck={false}
          className="block min-h-40 w-full resize-none bg-background p-3 font-mono text-xs leading-relaxed [field-sizing:content] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30"
        />
      </div>
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
          disabled={busy || (saved.isDefault && draft.trim() === defaults)}
          onClick={() => void save(null)}
        >
          Reset to default
        </button>
        <span role="status" className="text-xs text-muted-foreground">
          {status.kind === "saved" && config.savedText}
          {status.kind === "error" && (
            <span className="text-destructive">Could not save: {status.message}</span>
          )}
          {status.kind === "idle" && blank && "The instructions cannot be empty."}
        </span>
      </div>
    </div>
  );
}
