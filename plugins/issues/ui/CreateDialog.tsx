import { useState } from "react";
import { Markdown } from "@get-bb/plugin-sdk/app";
import type { RepoLabel, TicketDraft } from "../core/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { LabelChip, SectionLabel } from "./bits";
import type { RefineDraftRequest } from "./useIssuesBoard";

const NO_KEY_HINT = "Add an Anthropic or Groq API key in Settings → Plugins → Issues.";

/**
 * Two steps: describe the issue, then review the draft before creating it. Refine
 * turns the rough note into a structured draft through the AI provider; Skip AI
 * takes the note as the title.
 */
export function CreateDialog({
  labelOptions,
  initialLabels,
  busy,
  error,
  aiReady,
  onClose,
  onCreate,
  onRefine,
}: {
  labelOptions: RepoLabel[];
  initialLabels: string[];
  busy: boolean;
  /** A failed create, reported by the page. */
  error: string | null;
  /** Whether a provider key is configured; Refine is disabled without one. */
  aiReady: boolean;
  onClose: () => void;
  onCreate: (title: string, body: string, labels: string[]) => void;
  onRefine: (request: RefineDraftRequest) => Promise<TicketDraft>;
}) {
  const [note, setNote] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [editingBody, setEditingBody] = useState(true);
  const [hasDraft, setHasDraft] = useState(false);
  const [refining, setRefining] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [refineError, setRefineError] = useState<string | null>(null);
  const [labels, setLabels] = useState<string[]>(() => [...initialLabels]);

  function toggleLabel(name: string) {
    setLabels((current) => (current.includes(name) ? current.filter((l) => l !== name) : [...current, name]));
  }

  async function applyRefine(request: RefineDraftRequest) {
    if (busy || refining || !aiReady) return;
    setRefining(true);
    setRefineError(null);
    try {
      const draft = await onRefine(request);
      setTitle(draft.title);
      setBody(draft.body);
      setEditingBody(false);
      setHasDraft(true);
      if (request.feedback) setFeedback("");
    } catch (error) {
      setRefineError(error instanceof Error ? error.message : String(error));
    } finally {
      setRefining(false);
    }
  }

  function refine() {
    const text = note.trim();
    if (text) void applyRefine({ text, draft: null, feedback: "" });
  }

  function revise() {
    const text = feedback.trim();
    if (!text || !hasDraft) return;
    void applyRefine({ text: note.trim(), draft: { title: title.trim(), body: body.trim() }, feedback: text });
  }

  function skipAi() {
    const text = note.trim();
    if (!text || busy || refining) return;
    setTitle(text);
    setBody("");
    setEditingBody(true);
    setHasDraft(true);
    setRefineError(null);
  }

  function submit() {
    const trimmed = title.trim();
    if (!hasDraft || !trimmed || busy) return;
    onCreate(trimmed, body.trim(), [...labels]);
  }

  const heading = hasDraft ? "Review & create" : "New issue";

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="flex max-h-[85vh] max-w-xl flex-col gap-0 p-0">
        <DialogHeader className="border-b border-border px-5 py-3">
          <DialogTitle className="text-base">{heading}</DialogTitle>
          <DialogDescription className="sr-only">
            {hasDraft ? "Review the draft, then create the issue on GitHub." : "Describe the issue in your own words."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-5">
          {!hasDraft ? (
            <div className="flex flex-col gap-2">
              <SectionLabel htmlFor="issues-create-note">Describe the issue</SectionLabel>
              <Textarea
                id="issues-create-note"
                className="min-h-40"
                autoFocus
                value={note}
                placeholder="Rough idea, bug, or task"
                onChange={(event) => setNote(event.target.value)}
              />
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                <SectionLabel htmlFor="issues-create-title">Title</SectionLabel>
                <Input
                  id="issues-create-title"
                  value={title}
                  placeholder="Issue title"
                  onChange={(event) => setTitle(event.target.value)}
                />
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <SectionLabel htmlFor="issues-create-body">Description</SectionLabel>
                  <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => setEditingBody((v) => !v)}>
                    {editingBody ? "Preview" : "Edit"}
                  </Button>
                </div>
                {editingBody ? (
                  <Textarea
                    id="issues-create-body"
                    className="min-h-40"
                    value={body}
                    placeholder="Description…"
                    onChange={(event) => setBody(event.target.value)}
                  />
                ) : body.trim() ? (
                  <div className="rounded-lg border border-border p-3 text-sm">
                    <Markdown content={body} />
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">No description.</span>
                )}
              </div>

              {labelOptions.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <SectionLabel>Labels (optional)</SectionLabel>
                  <div className="flex flex-wrap gap-1.5">
                    {labelOptions.map((label) => (
                      <LabelChip
                        key={label.name}
                        name={label.name}
                        color={label.color}
                        on={labels.includes(label.name)}
                        onToggle={() => toggleLabel(label.name)}
                      />
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="flex flex-col gap-2">
                <SectionLabel htmlFor="issues-create-feedback">Feedback</SectionLabel>
                <Textarea
                  id="issues-create-feedback"
                  className="min-h-20"
                  value={feedback}
                  placeholder="Adjust the draft"
                  onChange={(event) => setFeedback(event.target.value)}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="self-start"
                  disabled={busy || refining || !feedback.trim() || !aiReady}
                  onClick={revise}
                >
                  {refining ? "Refining…" : "Refine with feedback"}
                </Button>
              </div>
            </>
          )}

          {error ? (
            <p role="alert" className="m-0 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {refineError ? (
            <p role="alert" className="m-0 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {refineError}
            </p>
          ) : null}
          {!aiReady ? <p className="m-0 text-xs text-muted-foreground">{NO_KEY_HINT}</p> : null}
        </div>

        <DialogFooter className="border-t border-border px-5 py-3">
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          {hasDraft ? (
            <Button size="sm" disabled={!title.trim() || busy} onClick={submit}>
              {busy ? "Creating…" : "Create issue"}
            </Button>
          ) : (
            <>
              <Button variant="outline" size="sm" disabled={!note.trim() || busy || refining} onClick={skipAi}>
                Skip AI
              </Button>
              <Button
                size="sm"
                disabled={!note.trim() || busy || refining || !aiReady}
                onClick={refine}
              >
                {refining ? "Refining…" : "Refine"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
