import { useEffect, useRef, useState, type RefObject } from "react";
import type { ProjectChoice, ProjectState } from "./rpc";
import { useProjectSettings } from "./use-project-settings";
import { PromptContent } from "./prompt-content";

type Confirmation = "discard" | "reset" | "reload";

/** One fixed project and one native modal lifetime. Confirmations replace its editor view. */
export function PromptDialog({
  project,
  trigger,
  writeLock,
  onPending,
  onConfirmed,
  onClose,
}: {
  project: ProjectChoice;
  trigger: HTMLButtonElement;
  writeLock: RefObject<boolean>;
  onPending: (pending: boolean) => void;
  onConfirmed: (state: ProjectState) => void;
  onClose: () => void;
}) {
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const settings = useProjectSettings(project.id, writeLock, confirmation === "reset");
  const {
    state,
    draft,
    dirty,
    changed,
    conflict,
    reading,
    reloading,
    readError,
    pending,
    writeError,
    saved,
    connection,
    refresh,
    edit,
    invalidPrompt,
  } = settings;
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const safeAction = useRef<HTMLButtonElement>(null);
  const confirmationOrigin = useRef<HTMLElement | null>(null);
  const resetExpected = useRef<{ prompt: string | null } | undefined>(undefined);
  const alive = useRef(false);
  const closing = useRef(false);
  const busy = pending || reloading;

  useEffect(() => {
    const modal = dialog.current!;
    alive.current = true;
    modal.showModal();
    title.current?.focus();
    return () => {
      alive.current = false;
      modal.close();
      queueMicrotask(() => {
        if (modal.open) return;
        if (trigger.isConnected && !trigger.disabled) trigger.focus();
        else document.getElementById("cleanup-overview-title")?.focus();
      });
    };
  }, [trigger]);
  useEffect(() => {
    onPending(pending);
  }, [pending, onPending]);
  useEffect(() => {
    if (confirmation) safeAction.current?.focus();
    else if (!busy && confirmationOrigin.current) {
      const target = confirmationOrigin.current;
      if (target.isConnected && !target.matches(":disabled")) target.focus();
      else title.current?.focus();
      confirmationOrigin.current = null;
    }
    if (!confirmation && dialog.current?.open) {
      const active = document.activeElement;
      if (!dialog.current.contains(active) || active?.matches(":disabled")) title.current?.focus();
    }
  }, [confirmation, busy, conflict, writeError]);

  function close() {
    if (writeLock.current || closing.current) return;
    closing.current = true;
    dialog.current?.close();
    onClose();
  }
  function ask(kind: Confirmation) {
    if (busy || writeLock.current) return;
    if (kind === "reset" && state) resetExpected.current = { prompt: state.prompt };
    confirmationOrigin.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setConfirmation(kind);
  }
  function dismiss() {
    if (busy || writeLock.current) return;
    if (confirmation) setConfirmation(null);
    else if (dirty) ask("discard");
    else close();
  }
  async function persist(prompt: string | null) {
    if (busy || writeLock.current || conflict || !state) return;
    const result = await settings.persist(
      project.name,
      prompt,
      prompt === null ? resetExpected.current : undefined,
    );
    if (!alive.current || closing.current || !result) return;
    onConfirmed(result);
    if (prompt !== null) close();
  }
  function save() {
    if (busy || writeLock.current || !dirty || conflict) return;
    if (!draft.trim() || draft.length > 4096) {
      invalidPrompt();
      return;
    }
    void persist(draft);
  }
  function confirm() {
    if (!confirmation || busy || writeLock.current) return;
    const action = confirmation;
    setConfirmation(null);
    if (action === "discard") close();
    else if (action === "reload") refresh(true);
    else void persist(null);
  }

  return (
    <dialog
      ref={dialog}
      className="cleanup-dialog"
      aria-labelledby="cleanup-dialog-title"
      aria-describedby="cleanup-dialog-note"
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      onKeyDown={(event) => {
        // Native modality makes the page inert; keep Tab at the dialog boundaries,
        // rather than letting Chromium move focus to its browser toolbar.
        if (event.key === "Tab") {
          const controls = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
            ),
          ).filter(
            (control) =>
              control.tabIndex >= 0 &&
              !control.matches(":disabled") &&
              !control.closest("[hidden]") &&
              control.getClientRects().length > 0,
          );
          const first = controls[0];
          const last = controls.at(-1);
          const active = document.activeElement;
          if (!first || !last) {
            event.preventDefault();
            title.current?.focus();
            return;
          }
          if (
            (!event.shiftKey && active === last) ||
            (event.shiftKey && (active === first || active === title.current))
          ) {
            event.preventDefault();
            (event.shiftKey ? last : first).focus();
          }
        }
        if (event.key === "Escape" && confirmation) {
          event.preventDefault();
          event.stopPropagation();
          if (!busy && !writeLock.current) setConfirmation(null);
        }
      }}
    >
      <header className="cleanup-dialog-header">
        <div>
          <h3 ref={title} tabIndex={-1} id="cleanup-dialog-title">
            Cleanup guidance for {project.name}
          </h3>
          {state && (
            <p className="cleanup-help">
              Saved prompt source: {state.prompt === null ? "Plugin default" : "Custom"}
            </p>
          )}
        </div>
        <button
          aria-label={`Close cleanup prompt for ${project.name}`}
          disabled={busy}
          onClick={dismiss}
        >
          Close
        </button>
      </header>
      <div className="cleanup-dialog-body">
        {confirmation && (
          <section className="cleanup-confirm" aria-labelledby="cleanup-confirm-title">
            <h3 id="cleanup-confirm-title">
              {confirmation === "reset"
                ? "Reset prompt to plugin default?"
                : "Discard unsaved prompt?"}
            </h3>
            <p>
              {confirmation === "reset"
                ? `Reset saves immediately for ${project.name}. It removes custom guidance and any draft, keeps this dialog open on the plugin default, and leaves enablement unchanged. Later Cancel will not undo this reset.`
                : confirmation === "reload"
                  ? `Discard the unsaved prompt for ${project.name} and reload saved guidance? Copy your draft first if you need it.`
                  : `Discard the unsaved prompt for ${project.name}? Saved guidance will not change.`}
            </p>
            <div className="cleanup-actions">
              <button ref={safeAction} onClick={() => setConfirmation(null)}>
                {confirmation === "discard" ? "Keep editing" : "Cancel"}
              </button>
              <button onClick={confirm}>
                {confirmation === "reset"
                  ? "Confirm reset"
                  : confirmation === "reload"
                    ? "Discard and reload"
                    : "Discard changes"}
              </button>
            </div>
          </section>
        )}
        <div hidden={confirmation !== null}>
          {connection !== "connected" && (
            <p role="status">
              Settings updates are not connected. Use Reload saved settings to check for missed
              changes.
            </p>
          )}
          {changed && (
            <p role={conflict ? "alert" : "status"}>
              {conflict
                ? "Prompt conflict. Save or Reset did not change the saved prompt."
                : "Saved settings changed."}{" "}
              Your draft is kept. Copy it before Reload if you need it.
            </p>
          )}
          {state && (
            <div className="cleanup-recovery">
              <button
                disabled={busy}
                onClick={() => {
                  if (dirty) ask("reload");
                  else refresh(true);
                }}
              >
                Reload saved settings
              </button>
              {reading && <p role="status">Refreshing saved settings…</p>}
            </div>
          )}
          {!state && !readError && <p role="status">Loading project settings…</p>}
          {readError && (
            <div>
              <p role="alert">
                Could not {state ? "refresh" : "load"} project settings: {readError}{" "}
                {state
                  ? "Last saved guidance is shown. The draft is kept."
                  : "Guidance is unknown."}
              </p>
              <button disabled={busy} onClick={() => refresh()}>
                Retry project
              </button>
            </div>
          )}
          {state && <PromptContent draft={draft} disabled={busy} dirty={dirty} onChange={edit} />}
          {pending && <p role="status">Saving for {project.name}…</p>}
          {saved && <p role="status">{saved}</p>}
          {writeError && (
            <p role="alert">
              Could not save: {writeError} The saved state and any draft are kept. Try again.
            </p>
          )}
        </div>
      </div>
      <footer className="cleanup-dialog-footer">
        <p className="cleanup-help" id="cleanup-dialog-note">
          Applies to new agent sessions only.
        </p>
        <div className="cleanup-dialog-actions" hidden={confirmation !== null}>
          <button
            disabled={busy || conflict || !state || (state.prompt === null && !dirty)}
            onClick={() => ask("reset")}
          >
            Reset to plugin default
          </button>
          <div className="cleanup-actions">
            <button disabled={busy} onClick={dismiss}>
              Cancel
            </button>
            <button className="cleanup-save" disabled={busy || conflict || !dirty} onClick={save}>
              Save
            </button>
          </div>
        </div>
      </footer>
    </dialog>
  );
}
