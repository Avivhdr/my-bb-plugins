import type { Operations } from "./operations.js";

export const localOperationCommands = [
  {
    name: "operations",
    summary: "Inspect bounded local operation records without BB calls",
    usage: "bb mcp operations [--operation ID | --cursor ID] [--limit 1..50] [--json]",
  },
  {
    name: "resolve-operation",
    summary: "Record an owner-verified outcome without repeating a BB action",
    usage:
      "bb mcp resolve-operation ID --outcome accepted|failed --project ID [--thread ID] [--delivery sent|queued] --verified [--json]",
  },
];

export function localOperationCommand(operations: Operations, argv: string[]) {
  const json = argv.includes("--json");
  try {
    const listing = argv[0] === "operations";
    const values: Record<string, string | boolean> = {};
    const allowed = listing
      ? ["operation", "cursor", "limit", "json"]
      : ["outcome", "project", "thread", "delivery", "verified", "json"];
    const operationId = listing ? undefined : argv[1];
    if (!listing && (!operationId || operationId.startsWith("--")))
      throw new Error("INVALID_ARGUMENTS");
    for (let i = listing ? 1 : 2; i < argv.length; i++) {
      const name = argv[i].startsWith("--") ? argv[i].slice(2) : "";
      if (!allowed.includes(name) || name in values) throw new Error("INVALID_ARGUMENTS");
      if (name === "json" || name === "verified") values[name] = true;
      else {
        const value = argv[++i];
        if (!value || value.startsWith("--")) throw new Error("INVALID_ARGUMENTS");
        values[name] = value;
      }
    }
    const data = listing
      ? operations.list({
          ...(values.operation === undefined ? {} : { operationId: values.operation }),
          ...(values.cursor === undefined ? {} : { cursor: values.cursor }),
          ...(values.limit === undefined
            ? {}
            : { limit: /^\d+$/.test(String(values.limit)) ? Number(values.limit) : NaN }),
        })
      : operations.resolve({
          operationId,
          projectId: values.project,
          outcome: values.outcome,
          verified: values.verified,
          ...(values.thread === undefined ? {} : { threadId: values.thread }),
          ...(values.delivery === undefined ? {} : { delivery: values.delivery }),
        });
    return { exitCode: 0, stdout: JSON.stringify(data, null, json ? undefined : 2) };
  } catch (error) {
    const code =
      error instanceof Error &&
      [
        "OPERATION_NOT_FOUND",
        "INVALID_QUERY",
        "SUMMARY_TOO_LARGE",
        "OPERATIONS_CLOSED",
        "OPERATION_ACTIVE",
        "OPERATION_ALREADY_FINAL",
        "INCONSISTENT_RESOLUTION",
      ].includes(error.message)
        ? error.message
        : "INVALID_ARGUMENTS";
    return {
      exitCode: 1,
      stderr: code,
      ...(json ? { stdout: JSON.stringify({ error: code }) } : {}),
    };
  }
}
