import type { PluginKvStorage } from "@get-bb/plugin-sdk";
import type { ActionResult } from "../contract";
import type { PullRequestRef } from "../core/pr-ref";
import { storedViewedSchema, type ViewedMarks } from "../core/viewed-marks";
import { createKeyedQueue } from "../core/keyed-queue";

export type ViewedMarksStore = ReturnType<typeof createViewedMarksStore>;

function keyOf({ owner, repo, number }: PullRequestRef): string {
  return `viewed:v1:${owner}/${repo}#${number}`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createViewedMarksStore(kv: PluginKvStorage) {
  const inOrder = createKeyedQueue();

  async function read(key: string): Promise<ViewedMarks> {
    const stored = storedViewedSchema.safeParse(await kv.get(key));
    return stored.success ? stored.data.marks : {};
  }

  return {
    get: (pr: PullRequestRef) => read(keyOf(pr)),

    update(pr: PullRequestRef, set: ViewedMarks, remove: readonly string[]): Promise<ActionResult> {
      const key = keyOf(pr);
      return inOrder(key, async () => {
        const marks: Record<string, string> = { ...(await read(key)), ...set };
        for (const path of remove) delete marks[path];
        if (Object.keys(marks).length === 0) await kv.delete(key);
        else await kv.set(key, { v: 1, marks });
        return { kind: "ok" as const };
      }).catch((error: unknown) => ({ kind: "error" as const, message: errorText(error) }));
    },
  };
}
