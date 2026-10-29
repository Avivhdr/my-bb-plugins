import type { PluginKvStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { ActionResult, ReviewInstructions } from "../contract";
import {
  DEFAULT_RE_REVIEW_INSTRUCTIONS,
  DEFAULT_REVIEW_INSTRUCTIONS,
  withDefaultRules,
} from "../core/review-prompt";

export const REVIEW_INSTRUCTIONS = {
  key: "review-instructions",
  defaults: DEFAULT_REVIEW_INSTRUCTIONS,
};

export const RE_REVIEW_INSTRUCTIONS = {
  key: "re-review-instructions",
  defaults: DEFAULT_RE_REVIEW_INSTRUCTIONS,
};

/** v1 held only the "How to review" text; v2 holds everything after the Steps. */
const storedSchema = z.object({
  v: z.union([z.literal(1), z.literal(2)]),
  instructions: z.string(),
});

/** The part of a prompt after the Steps, as saved in the plugin settings. */
export function createReviewInstructionsStore(
  kv: Pick<PluginKvStorage, "get" | "set" | "delete">,
  { key: KEY, defaults } = REVIEW_INSTRUCTIONS,
) {
  return {
    /** The saved instructions, or the defaults when none are saved or the entry is of another version. */
    async get(): Promise<ReviewInstructions> {
      const entry = storedSchema.safeParse(await kv.get(KEY));
      if (!entry.success) return { instructions: defaults, isDefault: true };
      const { v, instructions } = entry.data;
      return {
        instructions: v === 1 ? withDefaultRules(instructions, defaults) : instructions,
        isDefault: false,
      };
    },

    /** Saves the instructions, or goes back to the defaults for null. */
    async set(instructions: string | null): Promise<ActionResult> {
      try {
        if (instructions === null) await kv.delete(KEY);
        else await kv.set(KEY, { v: 2, instructions: instructions.trim() });
        return { kind: "ok" };
      } catch (error) {
        return { kind: "error", message: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}
