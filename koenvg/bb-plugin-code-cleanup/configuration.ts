import { PluginCliError, type BbPluginApi } from "@get-bb/plugin-sdk";
import type { ProjectSettingsStore } from "./project-settings";
import { defaultGuidance } from "./guidance";

import type { PromptResult } from "./rpc";

/** Delivery is best effort. A persisted write must still report success. */
export function notifySettings(
  bb: BbPluginApi,
  payload: { kind: "default" } | { kind: "project"; projectId: string },
) {
  try {
    bb.realtime.publish("settings.changed", payload);
  } catch {
    bb.log.warn(
      "Configuration saved, but Settings notification failed. Refresh Settings to read the saved value.",
    );
  }
}
/** Shared project validation and field-scoped operations for CLI and Settings. */
export function projectConfiguration(
  bb: BbPluginApi,
  settings: ProjectSettingsStore,
  getDefault: () => boolean,
) {
  async function listProjects() {
    const projects = await bb.sdk.projects.list({ includePersonal: true });
    return projects
      .filter((project) => project.kind === "standard")
      .map(({ id, name }) => ({ id, name }));
  }
  async function requireProject(projectId: string) {
    if (!(await listProjects()).some((project) => project.id === projectId)) {
      throw new PluginCliError(`No standard project with ID ${projectId}`, {
        code: "project_not_found",
        hint: "Use a standard project ID from `bb project list`.",
      });
    }
  }
  function snapshot(projectId: string, enableByDefault = getDefault()) {
    const state = settings.get(projectId, enableByDefault);
    return {
      projectId,
      ...state,
      enableByDefault,
      effectivePrompt: state.prompt ?? defaultGuidance(projectId),
    };
  }
  return {
    listProjects,
    async listProjectSummaries() {
      const projects = await listProjects();
      const enableByDefault = getDefault();
      return projects
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
        .map(({ id, name }) => {
          const state = snapshot(id, enableByDefault);
          return {
            id,
            name,
            enabled: state.enabled,
            enabledOverride: state.enabledOverride,
            promptSource: state.prompt === null ? ("default" as const) : ("custom" as const),
          };
        });
    },
    async getProject(projectId: string) {
      await requireProject(projectId);
      return snapshot(projectId);
    },
    async setEnablement(projectId: string, enabled: boolean | null) {
      await requireProject(projectId);
      settings.setEnabled(projectId, enabled);
      notifySettings(bb, { kind: "project", projectId });
      return snapshot(projectId);
    },
    async setPrompt(
      projectId: string,
      prompt: string | null,
      expected?: { prompt: string | null },
    ): Promise<PromptResult> {
      await requireProject(projectId);
      if (prompt !== null && (prompt.trim() === "" || prompt.length > 4096)) {
        throw new PluginCliError("Prompt must be nonblank and at most 4096 characters", {
          code: "invalid_value",
        });
      }
      if (expected && !settings.comparePrompt(projectId, prompt, expected.prompt)) {
        return { status: "conflict", state: snapshot(projectId) };
      }
      if (!expected) {
        if (prompt === null) settings.resetPrompt(projectId);
        else settings.setPrompt(projectId, prompt);
      }
      notifySettings(bb, { kind: "project", projectId });
      return { status: "saved", state: snapshot(projectId) };
    },
  };
}
