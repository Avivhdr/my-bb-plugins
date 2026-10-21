import { useRef, useState } from "react";
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import type { ProjectChoice } from "./rpc";
import { IconAction } from "./icon-action";
import { useProjectOverview } from "./use-project-overview";
import { ProjectOverview } from "./project-overview";
import { PromptDialog } from "./prompt-dialog";
import "./app.css";

function ProjectSettings() {
  const editorLock = useRef(false);
  const [editorPending, setEditorPending] = useState(false);
  const overview = useProjectOverview(editorLock, editorPending);
  const [editor, setEditor] = useState<{
    project: ProjectChoice;
    trigger: HTMLButtonElement;
  } | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  function openEditor(id: string, trigger: HTMLButtonElement) {
    if (editor || editorLock.current || overview.writeLock.current) return;
    const project = overview.rows?.find((row) => row.id === id);
    if (project) setEditor({ project: { id: project.id, name: project.name }, trigger });
  }

  return (
    <section className="code-cleanup-settings" aria-label="Code Cleanup project settings">
      <ProjectOverview
        overview={overview}
        blocked={editor !== null}
        activeProjectId={editor?.project.id}
        onEdit={openEditor}
      />
      {editor && (
        <PromptDialog
          key={editor.project.id}
          project={editor.project}
          trigger={editor.trigger}
          writeLock={editorLock}
          onPending={setEditorPending}
          onConfirmed={overview.confirmPrompt}
          onClose={() => {
            setEditorPending(false);
            setEditor(null);
          }}
        />
      )}
      <div className="cleanup-footer">
        <p className="cleanup-help">Applies to new agent sessions only.</p>
        <IconAction
          icon="Info"
          label="Task recording requirements"
          aria-expanded={showHelp}
          aria-controls="cleanup-help"
          onClick={() => setShowHelp((value) => !value)}
        />
      </div>
      <p
        id="cleanup-help"
        className="cleanup-help"
        role="region"
        aria-label="Task recording requirements"
        hidden={!showHelp}
      >
        The default records cleanup through agents. BB Tasks needs an available CLI and one linked
        tracker. These controls do not create tasks or trackers.
      </p>
    </section>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "project-settings",
    title: "Project guidance",
    component: ProjectSettings,
  });
});
