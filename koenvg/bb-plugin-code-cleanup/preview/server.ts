import { createServer, type IncomingMessage } from "node:http";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";

async function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new Error("Request too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, bytes).toString("utf8");
}

// This host owns temporary SQLite storage. It has no connection to the live BB host.
const host = createFakePluginHost({
  pluginId: "code-cleanup",
  sdk: {
    projects: {
      list: async () =>
        [
          { id: "fixture_alpha", name: "Alpha · saved custom prompt", kind: "standard" },
          { id: "fixture_beta", name: "Beta · plugin default", kind: "standard" },
          {
            id: "fixture_gamma",
            name: "Gamma · disabled with custom guidance for a project with a long name that wraps",
            kind: "standard",
          },
          { id: "fixture_delta", name: "Delta · explicit Off, plugin default", kind: "standard" },
          { id: "fixture_personal", name: "Personal · excluded", kind: "personal" },
        ] as never,
    },
  },
});
await plugin(host.bb);
await host.harness.behavior.runCli([
  "prompt",
  "set",
  "--project",
  "fixture_alpha",
  "--text",
  "  Fixture project guidance\n\nRecord substantial cleanup through BB Tasks only when a single tracker is linked to this project. Check for duplicates first. Keep the current work focused.\n\nThis custom prompt keeps its leading spaces and final newline.\n",
]);
await host.harness.behavior.runCli(["enable", "--project", "fixture_alpha"]);
await host.harness.behavior.runCli(["disable", "--project", "fixture_delta"]);
await host.harness.behavior.runCli(["disable", "--project", "fixture_gamma"]);
await host.harness.behavior.runCli([
  "prompt",
  "set",
  "--project",
  "fixture_gamma",
  "--text",
  "Disabled custom guidance",
]);
const vite = await createViteServer({
  root: fileURLToPath(new URL("..", import.meta.url)),
  configFile: false,
  server: { middlewareMode: true },
  appType: "custom",
});
let failedRefreshRead = false;
const server = createServer(async (req, res) => {
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(req.headers.host ?? "")) {
    res.statusCode = 403;
    res.end("Unapproved preview host");
    return;
  }
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/fixture-events") {
    const since = Number(url.searchParams.get("since") ?? 0);
    if (req.method !== "GET" || !Number.isSafeInteger(since) || since < 0) {
      res.statusCode = 400;
      res.end("A nonnegative event cursor and GET are required");
      return;
    }
    const events = host.harness.inspection.realtimeSignals;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ cursor: events.length, signals: events.slice(since) }));
    return;
  }
  if (url.pathname === "/fixture-default") {
    try {
      if (req.method === "POST") {
        const body = await readBody(req, 1024);
        await host.harness.behavior.setSettings(JSON.parse(body));
        if (url.searchParams.get("scenario") === "refresh-failure") failedRefreshRead = true;
      } else if (req.method !== "GET") throw new Error("GET or POST required");
      const state = (await host.harness.behavior.callRpc("getProject", {
        projectId: "fixture_beta",
      })) as { enableByDefault: boolean };
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          descriptor: host.harness.inspection.registrations.settingsDescriptors.enableByDefault,
          value: state.enableByDefault,
          signals: req.method === "POST" ? host.harness.inspection.realtimeSignals.slice(-1) : [],
        }),
      );
    } catch (error) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Fixture settings request failed",
        }),
      );
    }
    return;
  }
  if (url.pathname.startsWith("/fixture-rpc/")) {
    try {
      if (req.method !== "POST") throw new Error("POST required");
      const method = url.pathname.slice("/fixture-rpc/".length);
      if (
        ![
          "listProjects",
          "listProjectSummaries",
          "getProject",
          "setEnablement",
          "setPrompt",
        ].includes(method)
      )
        throw new Error("Unknown fixture operation");
      // Two 4096-character strings can each expand sixfold in JSON.
      const body = await readBody(req, 64 * 1024);
      const scenario = url.searchParams.get("scenario");
      await new Promise((resolve) => setTimeout(resolve, scenario === "slow" ? 2000 : 200));
      if (scenario === "refresh-failure" && method === "listProjectSummaries" && failedRefreshRead)
        throw new Error("Fixture refresh failure");
      if (scenario === "load-failure" && ["getProject", "listProjectSummaries"].includes(method))
        throw new Error("Fixture load failure");
      if (scenario === "save-failure" && ["setEnablement", "setPrompt"].includes(method))
        throw new Error("Fixture save failure");
      const result =
        scenario === "empty" && ["listProjects", "listProjectSummaries"].includes(method)
          ? []
          : await host.harness.behavior.callRpc(method, JSON.parse(body));
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ result }));
    } catch (error) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Fixture request failed",
        }),
      );
    }
    return;
  }
  if (url.pathname === "/") {
    const { readFile } = await import("node:fs/promises");
    const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
    res.setHeader("Content-Type", "text/html");
    res.end(await vite.transformIndexHtml(url.pathname, html));
    return;
  }
  vite.middlewares(req, res);
});
const port = Number(process.env.PORT ?? 4888);
server.listen(port, "127.0.0.1", () => {
  const address = server.address();
  if (address && typeof address !== "string")
    console.log(`Isolated Code Cleanup Settings fixture ready at http://127.0.0.1:${address.port}`);
});
async function stop() {
  server.close();
  await vite.close();
  await host.harness.lifecycle.dispose();
  process.exit(0);
}
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
