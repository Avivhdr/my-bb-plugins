import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import { CARD, PRIMARY_BUTTON, QUIET_BUTTON, TEXTAREA } from "./styles";

export interface InlineCommentFormProps {
  text: string;
  onTextChange: (text: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitLabel?: string;
}

export function InlineCommentForm({
  text,
  onTextChange,
  onSubmit,
  onCancel,
  submitLabel = "Add to review",
}: InlineCommentFormProps) {
  const labelId = useId();
  const box = useRef<HTMLTextAreaElement>(null);
  const blank = text.trim() === "";

  useEffect(() => {
    // The diff mounts annotations before it places them in the page, so autoFocus would land too early.
    const frame = requestAnimationFrame(() => box.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !blank) {
      event.preventDefault();
      onSubmit();
    }
  }

  return (
    <form
      className={`${CARD} border-border bg-background`}
      onSubmit={(event) => {
        event.preventDefault();
        if (!blank) onSubmit();
      }}
    >
      <span id={labelId} className="sr-only">
        Comment
      </span>
      <textarea
        aria-labelledby={labelId}
        ref={box}
        rows={2}
        className={TEXTAREA}
        placeholder="Leave a comment"
        value={text}
        onChange={(event) => onTextChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="flex items-center justify-end gap-2">
        <button type="button" className={QUIET_BUTTON} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className={PRIMARY_BUTTON} disabled={blank}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
