import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { isNewUserThread, Matcher, type Naming } from "./match";

// app.tsx imports only the type of this contract, so the frontend bundle never
// pulls in "@get-bb/plugin-sdk", which bb does not provide to frontends.
export const rpcContract = defineRpcContract({
  name: {
    input: z.object({
      projectId: z.string().regex(/^proj_[a-z0-9]+$/),
      title: z.string().trim().min(1).max(200),
    }),
    output: z.null(),
  },
});

export default function plugin(bb: BbPluginApi) {
  const matcher = new Matcher();

  const apply = (naming: Naming | null) => {
    if (!naming) return;
    bb.sdk.threads.update({ threadId: naming.threadId, title: naming.title }).then(
      () => bb.log.info(`named ${naming.threadId}`),
      (error: unknown) => bb.log.warn(`could not name ${naming.threadId}: ${String(error)}`),
    );
  };

  bb.experimental_hooks.on("message.dispatch", (ctx) => {
    const now = Date.now();
    const facts = {
      attempt: ctx.attempt,
      initiator: ctx.initiator,
      senderThreadId: ctx.senderThreadId,
      queuedCount: ctx.queuedMessages.length,
      thread: ctx.thread,
    };
    if (isNewUserThread(facts, now)) {
      apply(matcher.addDispatch({ threadId: ctx.thread.id, projectId: ctx.project.id, at: now }));
    }
    return { action: "proceed" };
  });

  bb.rpc.register(rpcContract, {
    name: ({ projectId, title }) => {
      apply(matcher.addClaim({ projectId, title, at: Date.now() }));
      return null;
    },
  });
}
