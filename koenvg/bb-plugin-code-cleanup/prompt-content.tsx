import { useRef, useState } from "react";
import { Markdown } from "@get-bb/plugin-sdk/app";
import { IconAction } from "./icon-action";

export function PromptContent({
  draft,
  disabled,
  dirty,
  onChange,
}: {
  draft: string;
  disabled: boolean;
  dirty: boolean;
  onChange: (text: string) => void;
}) {
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const editTab = useRef<HTMLButtonElement>(null);
  const previewTab = useRef<HTMLButtonElement>(null);
  function changeTab(next: "edit" | "preview") {
    setMode(next);
    (next === "edit" ? editTab : previewTab).current?.focus();
  }
  return (
    <div className="cleanup-editor">
      <label htmlFor="cleanup-prompt">Cleanup guidance</label>
      <div className="cleanup-toolbar" role="group" aria-label="Guidance controls">
        <div
          className="cleanup-tabs"
          role="tablist"
          aria-label="Guidance view"
          onKeyDown={(event) => {
            if (disabled) return;
            if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
              event.preventDefault();
              changeTab(
                event.key === "Home"
                  ? "edit"
                  : event.key === "End"
                    ? "preview"
                    : mode === "edit"
                      ? "preview"
                      : "edit",
              );
            }
          }}
        >
          <IconAction
            icon="Edit"
            label="Edit"
            ref={editTab}
            id="cleanup-edit-tab"
            role="tab"
            aria-selected={mode === "edit"}
            aria-controls="cleanup-edit-panel"
            tabIndex={mode === "edit" ? 0 : -1}
            disabled={disabled}
            onClick={() => setMode("edit")}
          />
          <IconAction
            icon="Eye"
            label="Preview"
            ref={previewTab}
            id="cleanup-preview-tab"
            role="tab"
            aria-selected={mode === "preview"}
            aria-controls="cleanup-preview-panel"
            tabIndex={mode === "preview" ? 0 : -1}
            disabled={disabled}
            onClick={() => setMode("preview")}
          />
        </div>
      </div>
      <div
        id="cleanup-edit-panel"
        role="tabpanel"
        aria-labelledby="cleanup-edit-tab"
        hidden={mode !== "edit"}
      >
        <textarea
          id="cleanup-prompt"
          value={draft}
          rows={12}
          disabled={disabled}
          spellCheck={false}
          aria-describedby="cleanup-count cleanup-draft"
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      <div
        id="cleanup-preview-panel"
        role="tabpanel"
        aria-labelledby="cleanup-preview-tab"
        hidden={mode !== "preview"}
      >
        {mode === "preview" && (
          <div
            className="cleanup-markdown"
            role="region"
            aria-label="Guidance preview"
            tabIndex={0}
          >
            {Markdown ? (
              <Markdown content={draft} />
            ) : (
              <>
                <p>Rendered preview is not available on this host. Source text is shown.</p>
                <pre>{draft}</pre>
              </>
            )}
          </div>
        )}
      </div>
      <div className="cleanup-metadata">
        <span id="cleanup-count">{draft.length} / 4096 characters</span>
      </div>
      <p id="cleanup-draft" hidden={!dirty}>
        Unsaved changes.
      </p>
    </div>
  );
}
