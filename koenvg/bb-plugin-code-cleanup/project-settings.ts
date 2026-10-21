import type { BbPluginApi } from "@get-bb/plugin-sdk";

type ProjectSettings = { enabled: boolean; enabledOverride: boolean | null; prompt: string | null };
type Row = { enabled_override: number | null; prompt: string | null };

/** One host-managed database per generation. Resolve only the override, not the legacy column. */
export function openProjectSettings(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    `CREATE TABLE IF NOT EXISTS project_settings (
      project_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0,
      prompt TEXT
    )`,
    `ALTER TABLE project_settings ADD COLUMN enabled_override INTEGER CHECK (enabled_override IN (0, 1))`,
    `UPDATE project_settings SET enabled_override = enabled`,
  ]);
  const getRow = db.prepare(
    "SELECT enabled_override, prompt FROM project_settings WHERE project_id = ?",
  );
  const setEnabled =
    db.prepare(`INSERT INTO project_settings (project_id, enabled, enabled_override)
    VALUES (?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET enabled = excluded.enabled, enabled_override = excluded.enabled_override`);
  const clearEnabled = db.prepare(
    "UPDATE project_settings SET enabled_override = NULL WHERE project_id = ?",
  );
  const setPrompt = db.prepare(`INSERT INTO project_settings (project_id, prompt)
    VALUES (?, ?) ON CONFLICT(project_id) DO UPDATE SET prompt = excluded.prompt`);

  // Acquire the write lock before reading, including when another connection writes.
  const comparePrompt = db.transaction(
    (projectId: string, prompt: string | null, expectedPrompt: string | null) => {
      const current = (getRow.get(projectId) as Row | undefined)?.prompt ?? null;
      if (current !== expectedPrompt) return false;
      setPrompt.run(projectId, prompt);
      return true;
    },
  );
  return {
    get(projectId: string, enableByDefault = false): ProjectSettings {
      const row = getRow.get(projectId) as Row | undefined;
      const enabledOverride = row?.enabled_override == null ? null : row.enabled_override === 1;
      return {
        enabled: enabledOverride ?? enableByDefault,
        enabledOverride,
        prompt: row?.prompt ?? null,
      };
    },
    setEnabled(projectId: string, enabled: boolean | null): void {
      if (enabled === null) clearEnabled.run(projectId);
      else setEnabled.run(projectId, enabled ? 1 : 0, enabled ? 1 : 0);
    },
    setPrompt(projectId: string, prompt: string): void {
      setPrompt.run(projectId, prompt);
    },
    resetPrompt(projectId: string): void {
      setPrompt.run(projectId, null);
    },
    comparePrompt(
      projectId: string,
      prompt: string | null,
      expectedPrompt: string | null,
    ): boolean {
      return comparePrompt.immediate(projectId, prompt, expectedPrompt);
    },
  };
}

export type ProjectSettingsStore = ReturnType<typeof openProjectSettings>;
