import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const projectInput = z.strictObject({ projectId: z.string().min(1) });
const projectState = z.strictObject({
  projectId: z.string().min(1),
  enabled: z.boolean(),
  enabledOverride: z.boolean().nullable(),
  enableByDefault: z.boolean(),
  prompt: z.string().nullable(),
  effectivePrompt: z.string(),
});
const projectSummary = z.strictObject({
  id: z.string().min(1),
  name: z.string(),
  enabled: z.boolean(),
  enabledOverride: z.boolean().nullable(),
  promptSource: z.enum(["custom", "default"]),
});
export const settingsContract = defineRpcContract({
  listProjects: {
    input: z.strictObject({}),
    output: z.array(z.strictObject({ id: z.string().min(1), name: z.string() })),
  },
  listProjectSummaries: {
    input: z.strictObject({}),
    output: z.array(projectSummary),
  },
  getProject: { input: projectInput, output: projectState },
  setEnablement: {
    input: z.strictObject({
      projectId: z.string().min(1),
      enabledOverride: z.boolean().nullable(),
    }),
    output: projectState,
  },
  setPrompt: {
    input: z.strictObject({
      projectId: z.string().min(1),
      prompt: z
        .string()
        .max(4096)
        .refine((text) => text.trim() !== "", "Prompt must be nonblank")
        .nullable(),
      expectedPrompt: z.string().nullable(),
    }),
    output: z.discriminatedUnion("status", [
      z.strictObject({ status: z.literal("saved"), state: projectState }),
      z.strictObject({ status: z.literal("conflict"), state: projectState }),
    ]),
  },
});
export type SettingsContract = typeof settingsContract;
export type ProjectState = z.infer<typeof projectState>;
export type ProjectSummary = z.infer<typeof projectSummary>;
export type ProjectChoice = { id: string; name: string };
export type PromptResult = z.infer<typeof settingsContract.setPrompt.output>;
