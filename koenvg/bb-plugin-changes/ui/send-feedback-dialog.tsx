import { useState, type KeyboardEvent } from "react";
import { PRIMARY_BUTTON, QUIET_BUTTON, TEXTAREA } from "../../review-ui/styles";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface SendFeedbackDialogProps {
  initialPrompt: string;
  sending: boolean;
  error: string | null;
  onSend: (text: string) => void;
  onClose: () => void;
}

export function SendFeedbackDialog({
  initialPrompt,
  sending,
  error,
  onSend,
  onClose,
}: SendFeedbackDialogProps) {
  const [text, setText] = useState(initialPrompt);
  const blank = text.trim() === "";

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !blank && !sending) {
      event.preventDefault();
      onSend(text);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !sending && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Review prompt</DialogTitle>
        </DialogHeader>
        <textarea
          aria-label="Review prompt"
          className={`${TEXTAREA} max-h-[60vh] min-h-48 font-mono text-xs`}
          value={text}
          disabled={sending}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {error !== null && (
          <p role="alert" className="break-words text-xs text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <button type="button" className={QUIET_BUTTON} disabled={sending} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={PRIMARY_BUTTON}
            disabled={blank || sending}
            onClick={() => onSend(text)}
          >
            {sending ? "Sending…" : "Send to agent"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
