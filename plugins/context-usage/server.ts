import { cliCommand, defineCli, defineRpcContract, PluginCliError, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { readProviderId, resolveContextUsage, type ContextUsage, type ProviderContext } from "./context";
import { grokSessionsRoot, readLatestGrokSignals } from "./grok-signals";

const threadIdSchema = z.string().regex(/^thr_[a-z0-9]+$/);

const usageSchema = z.object({
  percent: z.number().int().min(0).max(100),
  usedTokens: z.number().int().nonnegative(),
  windowTokens: z.number().int().positive(),
  estimated: z.boolean(),
  source: z.enum(["grok", "provider"]),
});

export const rpcContract = defineRpcContract({
  contextUsage: {
    input: z.object({ threadId: threadIdSchema }),
    output: usageSchema.nullable(),
  },
});

async function loadUsage(bb: BbPluginApi, threadId: string): Promise<ContextUsage | null> {
  const thread = await bb.sdk.threads.get({ threadId });
  const providerId = readProviderId(thread);
  const grok = providerId === "acp-grok" ? readLatestGrokSignals(threadId, grokSessionsRoot()) : null;
  let provider: ProviderContext | null = null;
  if (providerId !== "acp-grok") {
    const recorded = await bb.sdk.threads.context({ threadId });
    provider = recorded.usage ?? null;
  }
  return resolveContextUsage({ providerId, grok, provider });
}

export default function plugin(bb: BbPluginApi) {
  bb.rpc.register(rpcContract, {
    contextUsage: async ({ threadId }) => {
      try {
        return await loadUsage(bb, threadId);
      } catch (error: unknown) {
        bb.log.warn(`context usage for ${threadId}: ${String(error)}`);
        return null;
      }
    },
  });

  bb.cli.register(
    defineCli({
      name: "context-usage",
      summary: "Show how full a thread's context window is",
      commands: {
        show: cliCommand({
          summary: "Print the context window fill for one thread",
          positionals: [
            {
              name: "thread",
              description: "Thread id. Defaults to the current thread.",
              required: false,
            },
          ],
          options: {
            json: { type: "boolean", description: "Emit machine-readable JSON" },
          },
          async run({ positionals, options }, ctx) {
            const threadId = positionals.thread ?? ctx.threadId ?? "";
            const parsed = threadIdSchema.safeParse(threadId);
            if (!parsed.success) {
              throw new PluginCliError("Pass a thread id.", {
                code: "missing_thread",
                hint: "Usage: bb context-usage show <thread-id>",
              });
            }
            const usage = await loadUsage(bb, parsed.data);
            if (options.json) {
              return { exitCode: 0, stdout: `${JSON.stringify(usage)}\n` };
            }
            if (!usage) {
              return { exitCode: 0, stdout: "No context window usage is recorded for this thread.\n" };
            }
            const kind = usage.estimated ? "estimated " : "";
            return {
              exitCode: 0,
              stdout: `${usage.percent}% ${kind}(${usage.usedTokens} / ${usage.windowTokens} tokens)\n`,
            };
          },
        }),
      },
    }),
  );
}
