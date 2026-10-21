import { useId, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { ActionResult, rpcContract } from "../contract";
import { cn } from "@/lib/utils";
import { PRIMARY_BUTTON, TEXTAREA } from "./controls";
import { messageOf } from "./error-message";

export function PrCommentComposer({
  threadId,
  prNodeId,
  onPosted,
}: {
  threadId: string;
  prNodeId: string;
  onPosted: () => Promise<void>;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const errorId = useId();

  async function post() {
    if (inFlight.current || body.trim() === "") return;
    inFlight.current = true;
    setPosting(true);
    setError(null);
    const result = await rpc
      .call("addPrComment", { threadId, prNodeId, body })
      .catch((caught: unknown): ActionResult => ({ kind: "error", message: messageOf(caught) }));
    if (result.kind === "ok") {
      setBody("");
      await onPosted();
    } else setError(result.message);
    inFlight.current = false;
    setPosting(false);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        aria-label="Comment"
        aria-describedby={error === null ? undefined : errorId}
        className={TEXTAREA}
        placeholder="Add a comment"
        value={body}
        disabled={posting}
        onChange={(event) => setBody(event.target.value)}
      />
      {error !== null && (
        <p id={errorId} role="alert" className="break-words text-xs text-destructive">
          {error}
        </p>
      )}
      <button
        type="button"
        className={cn(PRIMARY_BUTTON, "self-end")}
        disabled={posting || body.trim() === ""}
        onClick={() => void post()}
      >
        {posting ? "Commenting…" : "Comment"}
      </button>
    </div>
  );
}
