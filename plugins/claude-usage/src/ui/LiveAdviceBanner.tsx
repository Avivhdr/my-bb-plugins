import { useState } from "react";
import { useComposer, useComposerView, useSdk } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { assessSession, projectMessages, STEPS_PER_MESSAGE } from "../advice";
import { formatMoney, formatTokens } from "../format";
import { InfoTip } from "./InfoTip";
import { SavingsLine } from "./SavingsLine";
import { useLiveSessions, useNow } from "./useLiveSessions";

/** Dismissals last for the page's life and only for the level dismissed, so a later, costlier state shows again. */
const dismissed = new Set<string>();

/**
 * Remembers which response a compaction was requested after, so the buttons
 * stay hidden until the transcript moves past it instead of inviting a
 * second click while bb is still compacting.
 */
const compacting = new Map<string, number>();

type Pending = "compact" | "send" | null;

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function LiveAdviceBanner() {
  const view = useComposerView();
  const composer = useComposer();
  const sdk = useSdk();
  const { value } = useLiveSessions();
  const now = useNow(5_000);
  const [, rerender] = useState(0);
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  if (view.scope.kind !== "thread") return null;
  const threadId = view.scope.threadId;
  const session = value?.sessions.find((entry) => entry.threadId === threadId);
  if (!session) return null;
  const running = view.run.isRunning || view.run.isSubmitting;
  const advice = assessSession(session, now, running);
  const dismissKey = `${threadId}:${advice.level}`;
  if (dismissed.has(dismissKey)) return null;
  const dismiss = (
    <Button
      size="icon"
      variant="ghost"
      className="size-6 shrink-0"
      aria-label="Dismiss"
      onClick={() => {
        dismissed.add(dismissKey);
        rerender((count) => count + 1);
      }}
    >
      <Icon name="X" aria-hidden />
    </Button>
  );

  // Below every threshold the cost still shows, as one quiet line.
  if (advice.level === "none") {
    return (
      <div role="status" className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">
          {advice.summary} · {formatTokens(session.context)} tokens of context
        </span>
        {dismiss}
      </div>
    );
  }

  const requested = compacting.get(threadId);
  const inFlight = requested !== undefined && requested === session.lastAt;
  if (requested !== undefined && !inFlight) compacting.delete(threadId);

  const run = async (kind: Exclude<Pending, null>, action: () => Promise<unknown>) => {
    setPending(kind);
    setError(null);
    try {
      await action();
      compacting.set(threadId, session.lastAt);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setPending(null);
    }
  };
  const compact = () => run("compact", () => sdk.threads.compact({ threadId }));
  // `compactFirst` queues the draft behind a /compact turn, so the message lands in the small context.
  const compactThenSend = () =>
    run("send", async () => {
      const text = composer.text.trim();
      await sdk.threads.send({
        threadId,
        mode: "start",
        input: [{ type: "text", text, mentions: [] }],
        compactFirst: true,
      } as Parameters<typeof sdk.threads.send>[0]);
      composer.clear();
    });
  // Plain text is all `threads.send` takes from here, so a draft with attachments keeps the normal send.
  const canSendDraft = !view.draft.isEmpty && view.draft.attachmentCount === 0;
  const urgent = advice.level === "cold";
  const projection = projectMessages(session, advice, 10);
  const disabled = running || pending !== null;

  return (
    <div
      role="status"
      className={`flex flex-col gap-1 rounded-lg border px-3 py-1.5 text-xs ${
        urgent ? "border-destructive/40 bg-destructive/10" : "border-border bg-muted/40"
      }`}
    >
      <div className="flex items-center gap-2">
        <Icon
          name={urgent ? "AlertTriangle" : "AlertCircle"}
          className={`size-3.5 shrink-0 ${urgent ? "text-destructive" : "text-muted-foreground"}`}
          aria-hidden
        />
        <span className="min-w-0 truncate font-medium">{advice.headline}</span>
        <InfoTip label="Why this costs money">
          <p className="m-0">{advice.detail}</p>
          <p className="m-0 mt-1.5 text-muted-foreground">
            Estimates assume about {STEPS_PER_MESSAGE} model calls per message, the average in your transcripts, and
            about 30K tokens left after compacting. What Claude writes costs the same either way and is left out.
            Compacting keeps a summary of the conversation, not every detail.
          </p>
        </InfoTip>
        <span className="flex-1" />
        {dismiss}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-5">
        {inFlight ? (
          <span className="text-muted-foreground">Compacting. The new size shows after the next response.</span>
        ) : (
          <>
            <span className="min-w-0 flex-1">
              <SavingsLine projection={projection} />
            </span>
            {running ? <span className="text-muted-foreground">Compacting waits for this turn to finish</span> : null}
            {canSendDraft ? (
              <Button size="sm" className="h-6 px-2 text-xs" disabled={disabled} onClick={compactThenSend}>
                {pending === "send" ? "Compacting…" : "Compact, then send"}
              </Button>
            ) : null}
            <Button
              size="sm"
              variant={canSendDraft ? "outline" : "default"}
              className="h-6 px-2 text-xs"
              disabled={disabled}
              onClick={compact}
            >
              {pending === "compact" ? "Compacting…" : `Compact now · ~${formatMoney(advice.compactCost)}`}
            </Button>
          </>
        )}
      </div>
      {error ? (
        <div role="alert" className="pl-5 text-destructive">
          Could not compact: {error}
        </div>
      ) : null}
    </div>
  );
}
