import { cliCommand, defineCli, type BbPluginApi } from "@get-bb/plugin-sdk";
import { openProjectSettings } from "./project-settings";
import { defaultGuidance } from "./guidance";
import { projectConfiguration, notifySettings } from "./configuration";
import { settingsContract } from "./rpc";

const projectOption = {
  project: { type: "string", required: true, description: "Standard BB project ID" },
} as const;

export default async function plugin(bb: BbPluginApi): Promise<void> {
  const defaults = bb.settings.define({
    enableByDefault: {
      type: "boolean",
      default: false,
      label: "Enable for projects without an override",
      description:
        "Includes new standard projects. Explicit project choices stay unchanged. This does not turn the BB plugin on or off.",
    },
  });
  let enableByDefault = (await defaults.get()).enableByDefault;
  defaults.onChange((next) => {
    enableByDefault = next.enableByDefault;
    notifySettings(bb, { kind: "default" });
  });
  const settings = openProjectSettings(bb);

  bb.agents.configure(({ project, origin }) => {
    if (project.kind !== "standard" || !project.id || origin.pluginId === "side-chat")
      return { tools: [], skills: [] };
    const state = settings.get(project.id, enableByDefault);
    if (!state.enabled) return { tools: [], skills: [] };
    return { tools: [], skills: [], instructions: state.prompt ?? defaultGuidance(project.id) };
  });

  const configuration = projectConfiguration(bb, settings, () => enableByDefault);
  bb.rpc.register(settingsContract, {
    listProjects: () => configuration.listProjects(),
    listProjectSummaries: () => configuration.listProjectSummaries(),
    getProject: ({ projectId }) => configuration.getProject(projectId),
    setEnablement: ({ projectId, enabledOverride }) =>
      configuration.setEnablement(projectId, enabledOverride),
    setPrompt: ({ projectId, prompt, expectedPrompt }) =>
      configuration.setPrompt(projectId, prompt, { prompt: expectedPrompt }),
  });

  bb.cli.register(
    defineCli({
      name: "code-cleanup",
      summary: "Manage project-scoped Code Cleanup guidance",
      commands: {
        enable: cliCommand({
          summary: "Enable guidance for one project",
          options: projectOption,
          async run({ options }) {
            await configuration.setEnablement(options.project, true);
            return { exitCode: 0, stdout: `Enabled Code Cleanup for ${options.project}.` };
          },
        }),
        disable: cliCommand({
          summary: "Disable guidance for one project (keep its prompt override)",
          options: projectOption,
          async run({ options }) {
            await configuration.setEnablement(options.project, false);
            return { exitCode: 0, stdout: `Disabled Code Cleanup for ${options.project}.` };
          },
        }),
        "enablement reset": cliCommand({
          summary: "Use the saved default for one project (keep its custom prompt)",
          options: projectOption,
          async run({ options }) {
            await configuration.setEnablement(options.project, null);
            return {
              exitCode: 0,
              stdout: `Code Cleanup for ${options.project} now follows the default.`,
            };
          },
        }),
        show: cliCommand({
          summary: "Show project enablement and prompt source",
          options: projectOption,
          async run({ options }) {
            const state = await configuration.getProject(options.project);
            return {
              exitCode: 0,
              stdout: `${options.project}: ${state.enabled ? "enabled" : "disabled"}; prompt: ${state.prompt === null ? "default" : "custom"}; enablement: ${state.enabledOverride === null ? "default" : "project override"}`,
            };
          },
        }),
        "prompt set": cliCommand({
          summary: "Replace this project's guidance with custom text",
          options: {
            ...projectOption,
            text: {
              type: "string",
              required: true,
              stdin: true,
              description: "Nonblank instruction text (up to 4096 characters)",
            },
          },
          async run({ options }) {
            await configuration.setPrompt(options.project, options.text);
            return { exitCode: 0, stdout: `Saved custom guidance for ${options.project}.` };
          },
        }),
        "prompt reset": cliCommand({
          summary: "Restore the default guidance for one project",
          options: projectOption,
          async run({ options }) {
            await configuration.setPrompt(options.project, null);
            return { exitCode: 0, stdout: `Restored default guidance for ${options.project}.` };
          },
        }),
      },
    }),
  );
}
