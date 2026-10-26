import type { PluginKvStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { ActionResult, ReviewInstructions } from "../contract";
import { DEFAULT_REVIEW_INSTRUCTIONS } from "../core/review-prompt";

const KEY = "review-instructions";

const storedSchema = z.object({ v: z.literal(1), instructions: z.string() });

/** The "How to review" part of the review prompt, as saved in the plugin settings. */
export function createReviewInstructionsStore(kv: Pick<PluginKvStorage, "get" | "set" | "delete">) {
  return {
    /** The saved instructions, or the defaults when none are saved or the entry is of another version. */
    async get(): Promise<ReviewInstructions> {
      const entry = storedSchema.safeParse(await kv.get(KEY));
      return entry.success
        ? { instructions: entry.data.instructions, isDefault: false }
        : { instructions: DEFAULT_REVIEW_INSTRUCTIONS, isDefault: true };
    },

    /** Saves the instructions, or goes back to the defaults for null. */
    async set(instructions: string | null): Promise<ActionResult> {
      try {
        if (instructions === null) await kv.delete(KEY);
        else await kv.set(KEY, { v: 1, instructions: instructions.trim() });
        return { kind: "ok" };
      } catch (error) {
        return { kind: "error", message: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}
