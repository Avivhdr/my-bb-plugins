import { createHash, randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Config } from "./config.js";
import { isRemoteProject } from "./project-access.js";
import { hasAccess, hasControl, providerSummarySchema } from "./control.js";
import type { Identity } from "./auth.js";

export type StartSource = {
  defaults: BbPluginApi["sdk"]["projects"]["defaultExecutionOptions"];
  listProviders: BbPluginApi["sdk"]["providers"]["list"];
  systemConfig: BbPluginApi["sdk"]["system"]["config"];
  spawn: BbPluginApi["sdk"]["threads"]["spawn"];
  get: BbPluginApi["sdk"]["threads"]["get"];
  send: BbPluginApi["sdk"]["threads"]["send"];
  stop: BbPluginApi["sdk"]["threads"]["stop"];
  queue: BbPluginApi["sdk"]["threads"]["queuedMessages"]["list"];
  interactions: BbPluginApi["sdk"]["threads"]["interactions"]["list"];
};
type Database = ReturnType<BbPluginApi["storage"]["database"]>;
type State = "pending" | "accepted" | "failed" | "unknown";
type RecordRow = {
  id: string;
  issuer: string;
  owner: string;
  tool: string;
  key: string;
  hash: string;
  project: string;
  thread: string | null;
  state: State;
  code: string | null;
  delivery: "sent" | "queued" | null;
  waiting_on: string | null;
  stop_status: string | null;
  queue_count: number | null;
  pending_interaction: number | null;
  created: number;
  updated: number;
  generation: string;
  resolved: number | null;
};
export const operationMigration = `CREATE TABLE operations (
  id TEXT PRIMARY KEY, issuer TEXT NOT NULL, owner TEXT NOT NULL, tool TEXT NOT NULL,
  key TEXT NOT NULL, hash TEXT NOT NULL, project TEXT NOT NULL, thread TEXT,
  state TEXT NOT NULL, code TEXT, created INTEGER NOT NULL, updated INTEGER NOT NULL,
  generation TEXT NOT NULL, UNIQUE(issuer, owner, tool, key)
)`;
export const operationSubmissionMigration = `ALTER TABLE operations ADD COLUMN delivery TEXT;
ALTER TABLE operations ADD COLUMN waiting_on TEXT;`;
export const operationStopMigration = `ALTER TABLE operations ADD COLUMN stop_status TEXT;
ALTER TABLE operations ADD COLUMN queue_count INTEGER;
ALTER TABLE operations ADD COLUMN pending_interaction INTEGER;`;
export const operationResolutionMigration = `ALTER TABLE operations ADD COLUMN resolved INTEGER;`;
export const operationLimits = { responseWaitMs: 4000, sdkDeadlineMs: 30000, capacity: 10000 };
const retentionMs = 24 * 60 * 60 * 1000;
const id = z.string().trim().min(1).max(200);
const text = z
  .string()
  .max(32768)
  .refine((v) => v.trim().length > 0 && Buffer.byteLength(v) <= 32768);
const startSchema = z.strictObject({
  projectId: id,
  prompt: text,
  title: z.string().trim().min(1).max(200).optional(),
  providerId: id.optional(),
  workspace: z.enum(["project-folder", "worktree"]).optional(),
  operationKey: z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/),
});
type StartInput = z.infer<typeof startSchema>;
const sendSchema = z.strictObject({
  threadId: id,
  message: text,
  operationKey: startSchema.shape.operationKey,
});
type SendInput = z.infer<typeof sendSchema>;
const stopSchema = z.strictObject({ threadId: id, operationKey: startSchema.shape.operationKey });
type StopInput = z.infer<typeof stopSchema>;
type Defaults = NonNullable<Awaited<ReturnType<StartSource["defaults"]>>>;
type Execution =
  | Defaults
  | (Pick<Defaults, "providerId" | "permissionMode"> & {
      model?: never;
      reasoningLevel?: never;
      serviceTier?: never;
    });

// One generation owns dispatches. Request transports only observe them.
export function operationControl(options: {
  db: Database;
  source: StartSource;
  policy: () => Config | null;
  now?: () => number;
  limits?: Partial<typeof operationLimits>;
}) {
  const { db, source, policy } = options;
  const now = options.now ?? Date.now;
  const limits = { ...operationLimits, ...options.limits };
  const generation = randomUUID();
  let active = false;
  let closed = false;
  let activeReads = 0;
  const running = new Map<string, { done: Promise<void>; timer: ReturnType<typeof setTimeout> }>();
  const read = (operationId: string) =>
    db.prepare("SELECT * FROM operations WHERE id = ?").get(operationId) as RecordRow | undefined;
  const claim = db.transaction(
    (identity: Identity, input: StartInput | SendInput | StopInput, project: string) => {
      const isStart = "prompt" in input;
      const tool = isStart
        ? "bb_start_thread"
        : "message" in input
          ? "bb_send_message"
          : "bb_stop_thread";
      const hash = createHash("sha256")
        .update(
          JSON.stringify(
            isStart
              ? [
                  input.projectId,
                  input.prompt,
                  input.title ?? null,
                  ...(input.providerId === undefined ? [] : [input.providerId]),
                  ...(input.workspace === undefined ? [] : [["workspace-v1", input.workspace]]),
                ]
              : "message" in input
                ? [input.threadId, input.message]
                : [input.threadId],
          ),
        )
        .digest("hex");
      // Expiry permits key reuse only for completed records, never pending/unknown.
      db.prepare(
        "DELETE FROM operations WHERE state IN ('accepted', 'failed') AND updated < ?",
      ).run(now() - retentionMs);
      const existing = db
        .prepare("SELECT * FROM operations WHERE issuer = ? AND owner = ? AND tool = ? AND key = ?")
        .get(identity.issuer, identity.owner, tool, input.operationKey) as RecordRow | undefined;
      if (existing) {
        if (existing.hash !== hash) throw new Error("OPERATION_CONFLICT");
        return { row: existing, fresh: false };
      }
      if (running.size >= 8) throw new Error("OPERATIONS_BUSY");
      if (
        (db.prepare("SELECT count(*) AS count FROM operations").get() as { count: number }).count >=
        limits.capacity
      )
        throw new Error("LEDGER_FULL");
      const row: RecordRow = {
        id: randomUUID(),
        issuer: identity.issuer,
        owner: identity.owner,
        tool,
        key: input.operationKey,
        hash,
        project,
        thread: isStart ? null : input.threadId,
        state: "pending",
        code: null,
        created: now(),
        delivery: null,
        waiting_on: null,
        stop_status: null,
        queue_count: null,
        pending_interaction: null,
        resolved: null,
        updated: now(),
        generation,
      };
      db.prepare(
        "INSERT INTO operations (id, issuer, owner, tool, key, hash, project, thread, state, code, created, updated, generation, delivery, waiting_on) VALUES (@id, @issuer, @owner, @tool, @key, @hash, @project, @thread, @state, @code, @created, @updated, @generation, @delivery, @waiting_on)",
      ).run(row);
      return { row, fresh: true };
    },
  );
  function requireAccess(identity: Identity, project?: string, write = false) {
    const config = policy();
    if (
      !active ||
      closed ||
      !hasAccess(config, identity) ||
      (project !== undefined && !isRemoteProject(project)) ||
      (write && !hasControl(config, identity))
    )
      throw new Error("OPERATION_UNAVAILABLE");
  }
  function finish(
    operationId: string,
    state: State,
    code: string | null,
    thread: string | null = null,
    delivery: RecordRow["delivery"] = null,
    waitingOn: string | null = null,
  ) {
    if (closed) return;
    db.prepare(
      "UPDATE operations SET state = ?, code = ?, thread = COALESCE(?, thread), delivery = ?, waiting_on = ?, updated = ? WHERE id = ? AND generation = ? AND state IN ('pending', 'unknown') AND resolved IS NULL",
    ).run(state, code, thread, delivery, waitingOn, now(), operationId, generation);
  }
  async function lookupThread(
    identity: Identity,
    threadId: string,
    project: string | undefined,
    write: boolean,
    signal: AbortSignal,
  ) {
    requireAccess(identity, project, write);
    if (activeReads >= 8 || signal.aborted) throw new Error("OPERATION_UNAVAILABLE");
    activeReads++;
    const lookup = Promise.resolve()
      .then(() => source.get({ threadId, signal }))
      .finally(() => {
        activeReads--;
      });
    let abort: () => void = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(new Error("OPERATION_UNAVAILABLE"));
      signal.addEventListener("abort", abort, { once: true });
    });
    try {
      const thread = await Promise.race([lookup, cancelled]);
      requireAccess(identity, project ?? thread.projectId ?? undefined, write);
      if (
        signal.aborted ||
        thread.id !== threadId ||
        !thread.projectId ||
        (project !== undefined && thread.projectId !== project) ||
        thread.deletedAt !== null
      )
        throw new Error("OPERATION_UNAVAILABLE");
      return thread;
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }
  async function observe(
    identity: Identity,
    operationId: string,
    write = false,
    signal = AbortSignal.timeout(3000),
  ) {
    const row = read(operationId);
    if (!row || row.issuer !== identity.issuer || row.owner !== identity.owner)
      throw new Error("OPERATION_UNAVAILABLE");
    requireAccess(identity, row.project, write);
    if (row.thread) await lookupThread(identity, row.thread, row.project, write, signal);
    if (signal.aborted) throw new Error("OPERATION_UNAVAILABLE");
    return {
      operationId: row.id,
      state: row.state,
      threadId: row.thread,
      code: row.code,
      ...(row.tool === "bb_send_message"
        ? { delivery: row.delivery, waitingOn: row.waiting_on }
        : {}),
      ...(row.tool === "bb_stop_thread"
        ? {
            stopRequested: row.state === "accepted" ? true : null,
            observation:
              row.stop_status === null
                ? null
                : {
                    status: row.stop_status,
                    queuedMessageCount: row.queue_count,
                    pendingInteraction: row.pending_interaction === 1,
                  },
          }
        : {}),
      meaning:
        row.resolved !== null
          ? row.state === "accepted"
            ? "Owner verified BB acceptance locally. This is not completed work or confirmed stop completion."
            : "Owner verified that BB did not accept this action. The original key remains protected."
          : row.state === "accepted"
            ? row.tool === "bb_stop_thread"
              ? "BB acknowledged the stop request. Stopping is not confirmed complete. Queue and approval observations are not an atomic snapshot; inspect BB."
              : row.delivery === "queued"
                ? "BB queued the instruction. Agent work is not complete; BB controls its dispatch."
                : "BB accepted the submission. Agent work is not complete."
            : row.state === "failed"
              ? row.tool === "bb_start_thread"
                ? "No start was dispatched."
                : row.tool === "bb_stop_thread"
                  ? "No stop was dispatched."
                  : "No message was dispatched."
              : row.state === "unknown"
                ? "Outcome unknown. Inspect BB before submitting a new key. Do not repeat the action."
                : "Submission outcome pending. Poll this operation; do not submit a new key.",
    };
  }
  async function captureStop(identity: Identity, row: RecordRow, sdkDeadline: number) {
    const signal = AbortSignal.timeout(Math.max(1, sdkDeadline - Date.now()));
    let abort: () => void = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(new Error("OBSERVATION_UNAVAILABLE"));
      signal.addEventListener("abort", abort, { once: true });
    });
    try {
      requireAccess(identity, row.project, true);
      if (activeReads > 6) return;
      activeReads += 2;
      const [queue, interactions] = await Promise.race([
        Promise.all([
          Promise.resolve()
            .then(() => source.queue({ threadId: row.thread!, signal }))
            .finally(() => {
              activeReads--;
            }),
          Promise.resolve()
            .then(() => source.interactions({ threadId: row.thread!, signal }))
            .finally(() => {
              activeReads--;
            }),
        ]),
        cancelled,
      ]);
      const thread = await lookupThread(identity, row.thread!, row.project, true, signal);
      // Save selected observations only. Stop acknowledgement survives failed reads.
      if (signal.aborted || closed) return;
      db.prepare(
        "UPDATE operations SET stop_status = ?, queue_count = ?, pending_interaction = ? WHERE id = ? AND generation = ? AND state = 'accepted'",
      ).run(
        thread.status,
        queue.length,
        interactions.some((item) => item.status === "pending" || item.status === "resolving")
          ? 1
          : 0,
        row.id,
        generation,
      );
    } catch {
      // An unavailable observation is not evidence of an empty queue or completed stop.
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }
  async function resolveEnvironment(
    workspace: StartInput["workspace"],
    signal: AbortSignal,
  ): Promise<Parameters<StartSource["spawn"]>[0]["environment"]> {
    if (workspace === undefined) return { type: "project-default" };
    const config = await source.systemConfig({ signal });
    const hostId = id.parse(config?.primaryHostId);
    return workspace === "project-folder"
      ? { type: "host", hostId, workspace: { type: "unmanaged", path: null } }
      : {
          type: "host",
          hostId,
          workspace: { type: "managed-worktree", baseBranch: { kind: "default" } },
        };
  }
  async function submit(
    identity: Identity,
    input: StartInput | SendInput | StopInput,
    project: string,
    signal: AbortSignal,
    started = Date.now(),
  ) {
    const isStart = "prompt" in input;
    const responseDeadline = started + limits.responseWaitMs;
    if (signal.aborted) throw new Error("OPERATION_UNAVAILABLE");
    requireAccess(identity, project, true);
    const { row, fresh } = claim.immediate(identity, input, project);
    if (fresh) {
      let dispatched = false;
      const sdkDeadline = Date.now() + limits.sdkDeadlineMs;
      let deadline = false;
      const timer = setTimeout(() => {
        deadline = true;
        try {
          finish(
            row.id,
            dispatched ? "unknown" : "failed",
            dispatched ? "SDK_DEADLINE" : "PRE_DISPATCH_DEADLINE",
          );
        } catch {
          /* Durable pending key still prevents replay. */
        }
      }, limits.sdkDeadlineMs);
      const disconnected = () => {
        try {
          finish(
            row.id,
            dispatched ? "unknown" : "failed",
            dispatched ? "CLIENT_DISCONNECTED" : "PRE_DISPATCH_ABORTED",
          );
        } catch {
          /* Keep the durable claim. */
        }
      };
      signal.addEventListener("abort", disconnected, { once: true });
      const checkDispatch = () => {
        requireAccess(identity, project, true);
        if (deadline || signal.aborted || Date.now() >= sdkDeadline)
          throw new Error("PRE_DISPATCH_ABORTED");
        const current = read(row.id);
        if (current?.generation !== generation || current.state !== "pending")
          throw new Error("STALE_DISPATCH");
      };
      const readSignal = () =>
        AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, sdkDeadline - Date.now()))]);
      const done = Promise.resolve().then(async () => {
        try {
          checkDispatch();
          const defaults = isStart
            ? await source.defaults({ projectId: project, signal: readSignal() })
            : null;
          let execution: Execution | undefined;
          if (isStart) {
            checkDispatch();
            if (!defaults) throw new Error("DEFAULTS_UNAVAILABLE");
            execution = {
              providerId: defaults.providerId,
              model: defaults.model,
              permissionMode: defaults.permissionMode,
              reasoningLevel: defaults.reasoningLevel,
              serviceTier: defaults.serviceTier,
            };
            if (input.providerId !== undefined) {
              const listed = await source.listProviders({ signal: readSignal() });
              checkDispatch();
              const selected = providerSummarySchema
                .array()
                .parse(listed)
                .find(({ id }) => id === input.providerId);
              if (
                !selected?.available ||
                !selected.permissionModes.includes(defaults.permissionMode)
              )
                throw new Error("PROVIDER_UNAVAILABLE");
              if (selected.id !== defaults.providerId)
                execution = { providerId: selected.id, permissionMode: defaults.permissionMode };
            }
          } else {
            await lookupThread(identity, input.threadId, project, true, readSignal());
          }
          checkDispatch();
          const environment = isStart
            ? await resolveEnvironment(input.workspace, readSignal())
            : null;
          checkDispatch();
          dispatched = true;
          if (isStart) {
            const thread = await source.spawn({
              ...execution!,
              projectId: project,
              prompt: input.prompt,
              ...(input.title === undefined ? {} : { title: input.title }),
              environment: environment!,
              visibility: "visible",
              pluginMetadata: { operationId: row.id },
            });
            if (
              !thread ||
              typeof thread.id !== "string" ||
              !thread.id.length ||
              thread.id.length > 200
            )
              throw new Error();
            finish(row.id, "accepted", null, thread.id);
          } else if ("message" in input) {
            const sent = await source.send({
              threadId: input.threadId,
              mode: "auto",
              input: [{ type: "text", text: input.message, mentions: [] }],
            });
            if (!sent || sent.ok !== true || !["sent", "queued"].includes(sent.delivery))
              throw new Error();
            const waitingOn =
              sent.delivery === "queued" ? (sent.queuedMessage?.waitingOn?.kind ?? null) : null;
            if (
              sent.delivery === "queued" &&
              (!sent.queuedMessage || sent.queuedMessage.threadId !== input.threadId)
            )
              throw new Error();
            finish(row.id, "accepted", null, input.threadId, sent.delivery, waitingOn);
          } else {
            const stopped = await source.stop({ threadId: input.threadId });
            if (!stopped || stopped.ok !== true) throw new Error();
            finish(row.id, "accepted", null, input.threadId);
            await captureStop(identity, row, sdkDeadline);
          }
        } catch {
          // No public transactional submission-error guarantee: even a BB error may follow submission.
          try {
            finish(
              row.id,
              dispatched ? "unknown" : "failed",
              dispatched
                ? "BB_OUTCOME_UNKNOWN"
                : isStart
                  ? "START_NOT_DISPATCHED"
                  : "message" in input
                    ? "MESSAGE_NOT_DISPATCHED"
                    : "STOP_NOT_DISPATCHED",
            );
          } catch {
            /* Never lose the claim or retry. */
          }
        } finally {
          clearTimeout(timer);
          signal.removeEventListener("abort", disconnected);
          running.delete(row.id);
        }
      });
      running.set(row.id, { done, timer });
    }
    const pending = running.get(row.id);
    if (pending) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          pending.done,
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, Math.max(1, responseDeadline - Date.now() - 1000));
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    }
    if (signal.aborted) throw new Error("OPERATION_UNAVAILABLE");
    return observe(
      identity,
      row.id,
      true,
      AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, responseDeadline - Date.now()))]),
    );
  }
  const resolve = db.transaction((input: unknown) => {
    const verified = z
      .strictObject({
        operationId: id,
        projectId: id,
        threadId: id.optional(),
        outcome: z.enum(["accepted", "failed"]),
        verified: z.literal(true),
        delivery: z.enum(["sent", "queued"]).optional(),
      })
      .parse(input);
    if (closed) throw new Error("OPERATIONS_CLOSED");
    const row = read(verified.operationId);
    if (!row) throw new Error("OPERATION_NOT_FOUND");
    if (running.has(row.id) || row.state === "pending") throw new Error("OPERATION_ACTIVE");
    if (row.state !== "unknown" || row.resolved !== null)
      throw new Error("OPERATION_ALREADY_FINAL");
    const accepted = verified.outcome === "accepted";
    const send = row.tool === "bb_send_message";
    if (
      !["bb_start_thread", "bb_send_message", "bb_stop_thread"].includes(row.tool) ||
      verified.projectId !== row.project ||
      (row.thread !== null && verified.threadId !== row.thread) ||
      (accepted && !verified.threadId) ||
      (!accepted && row.thread === null && verified.threadId !== undefined) ||
      (send && accepted ? verified.delivery === undefined : verified.delivery !== undefined)
    )
      throw new Error("INCONSISTENT_RESOLUTION");
    const stamp = now();
    db.prepare(`UPDATE operations SET state = ?, code = ?, thread = COALESCE(?, thread),
      delivery = ?, waiting_on = NULL, stop_status = NULL, queue_count = NULL,
      pending_interaction = NULL, updated = ?, resolved = ?
      WHERE id = ? AND state = 'unknown' AND resolved IS NULL`).run(
      verified.outcome,
      accepted ? "OWNER_VERIFIED_ACCEPTED" : "OWNER_VERIFIED_FAILED",
      verified.threadId ?? null,
      verified.delivery ?? null,
      stamp,
      stamp,
      row.id,
    );
    return row.id;
  });
  function result(data: Awaited<ReturnType<typeof observe>>) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify(data) }],
      structuredContent: data,
    };
  }
  return {
    resolve(input: unknown) {
      const operationId = resolve.immediate(input);
      return this.list({ operationId });
    },
    list(input: unknown = {}) {
      const query = z
        .strictObject({
          operationId: id.optional(),
          limit: z.number().int().min(1).max(50).default(50),
          cursor: id.optional(),
        })
        .parse(input);
      if (closed) throw new Error("OPERATIONS_CLOSED");
      if (query.operationId && query.cursor) throw new Error("INVALID_QUERY");
      const rows = query.operationId
        ? [read(query.operationId)].filter((row): row is RecordRow => !!row)
        : (db
            .prepare("SELECT * FROM operations WHERE id > ? ORDER BY id LIMIT ?")
            .all(query.cursor ?? "", query.limit + 1) as RecordRow[]);
      if (query.operationId && !rows.length) throw new Error("OPERATION_NOT_FOUND");
      const summaries = rows.map((row) => ({
        operationId: row.id,
        issuer: row.issuer,
        owner: row.owner,
        tool: row.tool,
        operationKey: row.key,
        projectId: row.project,
        threadId: row.thread,
        state: row.state,
        code: row.code,
        createdAt: row.created,
        updatedAt: row.updated,
        resolvedAt: row.resolved,
        active: running.has(row.id),
      }));
      // Keep local output below 64 KiB even with long owner/issuer identities.
      const page: typeof summaries = [];
      let bytes = 0;
      for (const summary of summaries.slice(0, query.limit)) {
        const size = Buffer.byteLength(JSON.stringify(summary, null, 2));
        if (bytes + size > 60000) break;
        page.push(summary);
        bytes += size;
      }
      if (summaries.length && !page.length) throw new Error("SUMMARY_TOO_LARGE");
      return {
        operations: page,
        nextCursor: summaries.length > page.length ? page.at(-1)!.operationId : null,
      };
    },
    activate() {
      if (closed) throw new Error("OPERATIONS_CLOSED");
      if (active) return;
      // FULL makes the committed identity durable before SDK dispatch.
      db.pragma("synchronous = FULL");
      db.prepare(
        "UPDATE operations SET state = 'unknown', code = 'PLUGIN_RESTART', updated = ? WHERE state = 'pending' AND generation != ?",
      ).run(now(), generation);
      active = true;
    },
    close() {
      if (closed) return;
      for (const { timer } of running.values()) clearTimeout(timer);
      db.prepare(
        "UPDATE operations SET state = 'unknown', code = 'PLUGIN_STOPPED', updated = ? WHERE state = 'pending' AND generation = ?",
      ).run(now(), generation);
      closed = true;
      active = false;
    },
    register(
      server: McpServer,
      identity: Identity,
      signal: AbortSignal,
      onFailure: (tool: OperationTool) => void,
    ) {
      const controlRequirement =
        identity.mode === "cloudflare-access"
          ? "Requires the verified owner/app local read-control permission and local control."
          : "Requires bb.read, bb.control and local control.";
      server.registerTool(
        "bb_start_thread",
        {
          description: `Start an ordinary visible BB thread in a standard project using project defaults with optional independent providerId and workspace selections. Explicit provider selection requires an available provider supporting the saved permission mode. A different provider uses its catalog defaults for model, reasoning and service tier. Omit workspace for unchanged project-default behavior. Choose project-folder for the configured source folder on BB's primary host, shared without a branch change, or worktree for a new worktree from BB's default base branch. Host, path and branch choices are not supported. BB's built-in Personal project is excluded. Execution permissions stay unchanged. ${controlRequirement} Agents can change code, take external actions and incur provider costs under existing permissions. Use the same operationKey and exact input, including both selections or their omission, to recover a lost reply; changed input conflicts. Submission acceptance is not agent completion. Unknown outcomes must not be retried under a new key.`,
          inputSchema: startSchema,
          annotations: {
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: true,
            openWorldHint: true,
          },
        },
        async (input) => {
          try {
            return result(await submit(identity, input, input.projectId, signal));
          } catch (error) {
            onFailure("bb_start_thread");
            const code =
              error instanceof Error &&
              ["OPERATION_CONFLICT", "LEDGER_FULL", "OPERATIONS_BUSY"].includes(error.message)
                ? error.message
                : "OPERATION_UNAVAILABLE";
            return { isError: true, content: [{ type: "text" as const, text: code }] };
          }
        },
      );
      server.registerTool(
        "bb_send_message",
        {
          description: `Send follow-up instructions to a BB thread in a standard project, excluding BB's built-in Personal project, with normal idle/active auto behavior. ${controlRequirement} Agents can change code, take external actions and incur provider costs under existing permissions. Accepted or queued is not completed work. Keep the same key after a lost reply; unknown requires BB inspection. Pending approvals remain in BB.`,
          inputSchema: sendSchema,
          annotations: {
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: true,
            openWorldHint: true,
          },
        },
        async (input) => {
          try {
            const started = Date.now();
            const thread = await lookupThread(
              identity,
              input.threadId,
              undefined,
              true,
              AbortSignal.any([signal, AbortSignal.timeout(limits.responseWaitMs)]),
            );
            return result(await submit(identity, input, thread.projectId!, signal, started));
          } catch (error) {
            onFailure("bb_send_message");
            const code =
              error instanceof Error &&
              ["OPERATION_CONFLICT", "LEDGER_FULL", "OPERATIONS_BUSY"].includes(error.message)
                ? error.message
                : "OPERATION_UNAVAILABLE";
            return { isError: true, content: [{ type: "text" as const, text: code }] };
          }
        },
      );
      server.registerTool(
        "bb_stop_thread",
        {
          description: `Request an ordinary stop of a BB thread in a standard project, excluding BB's built-in Personal project, preserving its history. ${controlRequirement} This write does not delete queued input or approve pending permissions. Acknowledgement is not confirmed stop completion. Keep the same key after a lost reply; unknown requires BB inspection.`,
          inputSchema: stopSchema,
          annotations: {
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: true,
            openWorldHint: false,
          },
        },
        async (input) => {
          try {
            const started = Date.now();
            const thread = await lookupThread(
              identity,
              input.threadId,
              undefined,
              true,
              AbortSignal.any([signal, AbortSignal.timeout(limits.responseWaitMs)]),
            );
            return result(await submit(identity, input, thread.projectId!, signal, started));
          } catch (error) {
            onFailure("bb_stop_thread");
            const code =
              error instanceof Error &&
              ["OPERATION_CONFLICT", "LEDGER_FULL", "OPERATIONS_BUSY"].includes(error.message)
                ? error.message
                : "OPERATION_UNAVAILABLE";
            return { isError: true, content: [{ type: "text" as const, text: code }] };
          }
        },
      );
      server.registerTool(
        "bb_get_operation",
        {
          description:
            "Read the owner's persisted submission outcome in a standard project without repeating an action. BB's built-in Personal project is excluded, including old records. Accepted is not completed agent work. Unknown outcomes require inspection in BB before a new key.",
          inputSchema: z.strictObject({ operationId: id }),
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
        },
        async ({ operationId }) => {
          try {
            if (signal.aborted) throw new Error();
            const data = await observe(
              identity,
              operationId,
              false,
              AbortSignal.any([signal, AbortSignal.timeout(3000)]),
            );
            if (signal.aborted) throw new Error();
            return result(data);
          } catch {
            onFailure("bb_get_operation");
            return {
              isError: true,
              content: [{ type: "text" as const, text: "OPERATION_UNAVAILABLE" }],
            };
          }
        },
      );
    },
  };
}
export type OperationTool =
  | "bb_start_thread"
  | "bb_send_message"
  | "bb_stop_thread"
  | "bb_get_operation";
export type Operations = ReturnType<typeof operationControl>;
