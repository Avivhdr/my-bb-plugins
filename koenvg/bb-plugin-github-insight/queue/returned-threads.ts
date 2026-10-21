import type { PluginKvStorage } from "@get-bb/plugin-sdk";

const PREFIX = "review-returned:";

export function createReturnedThreads(
  kv: Pick<PluginKvStorage, "get" | "set" | "delete" | "list">,
) {
  return {
    add: (threadId: string) => kv.set(`${PREFIX}${threadId}`, { v: 1 }),

    delete: (threadId: string) => kv.delete(`${PREFIX}${threadId}`),

    has: async (threadId: string) => (await kv.get(`${PREFIX}${threadId}`)) !== undefined,

    async list(): Promise<Set<string>> {
      return new Set((await kv.list(PREFIX)).map((key) => key.slice(PREFIX.length)));
    },
  };
}
