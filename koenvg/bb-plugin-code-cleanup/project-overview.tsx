import { IconAction } from "./icon-action";
import type { ProjectSummary } from "./rpc";
import type { useProjectOverview } from "./use-project-overview";

type Overview = ReturnType<typeof useProjectOverview>;

export function ProjectOverview({
  overview,
  blocked,
  onEdit,
  activeProjectId,
}: {
  overview: Overview;
  blocked: boolean;
  onEdit: (id: string, trigger: HTMLButtonElement) => void;
  activeProjectId?: string;
}) {
  const { rows, reading, readError, pending, writeError, saved } = overview;
  const disabled = blocked || !!pending || !!readError;
  function persist(row: ProjectSummary, value: boolean | null) {
    if (disabled) return;
    void overview.persist(row, value);
  }
  return (
    <section className="cleanup-overview" aria-labelledby="cleanup-overview-title">
      <h3 id="cleanup-overview-title" tabIndex={-1}>
        Saved project settings
      </h3>
      <p className="cleanup-help">
        Saved values, not unsaved prompt drafts. Applies to new agent sessions only.
      </p>
      {reading && (
        <p role="status">{rows ? "Refreshing project overview…" : "Loading project overview…"}</p>
      )}
      {readError && (
        <div>
          <p role="alert">
            Could not {rows ? "refresh" : "load"} project overview: {readError}
            {rows
              ? " Last saved values are shown. Reload before changing settings."
              : " Settings are unknown."}
          </p>
          <button disabled={!!pending || blocked || reading} onClick={overview.refresh}>
            Retry overview
          </button>
        </div>
      )}
      {rows?.length === 0 && <p>No standard projects are available in the overview.</p>}
      {!!rows?.length && (
        <table className="cleanup-overview-table" aria-label="Saved project settings">
          <thead>
            <tr>
              <th scope="col">Project</th>
              <th scope="col">Enabled</th>
              <th scope="col">
                Setting source <span className="cleanup-source-heading-note">Enablement only</span>
              </th>
              <th scope="col">Prompt</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} data-editing={activeProjectId === row.id}>
                <th scope="row">
                  <button
                    className="cleanup-project-name"
                    aria-label={`Open cleanup prompt for ${row.name}`}
                    aria-haspopup="dialog"
                    disabled={blocked || !!pending}
                    onClick={(event) => onEdit(row.id, event.currentTarget)}
                  >
                    {row.name}
                  </button>
                </th>
                <td data-label="Enabled">
                  <IconAction
                    icon={row.enabled ? "On" : "Off"}
                    label={`Enable Code Cleanup for ${row.name}`}
                    tooltip={`Code Cleanup is ${row.enabled ? "On" : "Off"} for ${row.name}.`}
                    role="switch"
                    aria-checked={row.enabled}
                    disabled={disabled}
                    onClick={() => persist(row, !row.enabled)}
                  />
                </td>
                <td data-label="Setting source · enablement only">
                  <div className="cleanup-setting-source">
                    <span>{row.enabledOverride === null ? "Default" : "Project override"}</span>
                    {row.enabledOverride !== null && (
                      <IconAction
                        icon="RotateCcw"
                        label={`Use default for ${row.name}`}
                        disabled={disabled}
                        onClick={() => persist(row, null)}
                      />
                    )}
                  </div>
                </td>
                <td data-label="Prompt">
                  {row.promptSource === "custom" ? "Custom" : "Plugin default"}
                </td>
                <td data-label="Actions">
                  <button
                    aria-label={`Edit prompt for ${row.name}`}
                    aria-haspopup="dialog"
                    disabled={blocked || !!pending}
                    onClick={(event) => onEdit(row.id, event.currentTarget)}
                  >
                    Edit prompt
                  </button>
                  {pending === row.id && <p role="status">Saving for {row.name}…</p>}
                  {writeError?.id === row.id && (
                    <p role="alert">
                      Could not save settings for {row.name}: {writeError.message} Last saved values
                      are kept. Try the control again.
                    </p>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {saved && <p role="status">{saved}</p>}
    </section>
  );
}
