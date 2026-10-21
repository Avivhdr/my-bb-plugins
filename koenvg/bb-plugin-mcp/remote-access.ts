import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticator } from "./auth.js";
import { type Config, type Connection } from "./config.js";
import { hasAccess, projectServer, type ProjectSource, type ProviderSource } from "./control.js";
import type { ThreadSource, ThreadTool } from "./thread-tools.js";
import type { Operations, OperationTool } from "./operations.js";

export const limits = {
  bodyBytes: 65536,
  responseBytes: 65536,
  deadlineMs: 5000,
  concurrent: 8,
  perMinute: 120,
};
const metadataPaths = new Set([
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/mcp",
]);

export function remoteAccess(options: {
  connection: Connection;
  policy: () => Config | null;
  projects: ProjectSource;
  providers: ProviderSource;
  threads: ThreadSource;
  operations?: Operations;
  log: (event: {
    request: string;
    code: string;
    tool?: "bb_list_projects" | "bb_list_providers" | ThreadTool | OperationTool;
  }) => void;
  fetch?: typeof fetch;
  limits?: Partial<typeof limits>;
}) {
  const bound = { ...limits, ...options.limits };
  const verify = authenticator(options.fetch);
  let listener: Server | undefined;
  let closing: Promise<void> | undefined;
  let starting: Promise<void> | undefined;
  let state: "stopped" | "starting" | "listening" | "error" = "stopped";
  let active = 0;
  let activeBB = 0;
  async function read<T>(operation: () => Promise<T>): Promise<T> {
    if (activeBB >= bound.concurrent) throw new Error("BUSY");
    activeBB++;
    try {
      return await operation();
    } finally {
      activeBB--;
    }
  }
  const projects: ProjectSource = { list: () => read(() => options.projects.list()) };
  const providers: ProviderSource = { list: (args) => read(() => options.providers.list(args)) };
  const threads: ThreadSource = {
    list: (args) => read(() => options.threads.list(args)),
    get: (args) => read(() => options.threads.get(args)),
    output: (args) => read(() => options.threads.output(args)),
    interactions: { list: (args) => read(() => options.threads.interactions.list(args)) },
  };
  let count = 0;
  let windowStart = Date.now();
  const requests = new Set<{ response: ServerResponse; controller: AbortController }>();
  const resource = options.connection.publicOrigin + "/mcp";
  const metadata = options.connection.publicOrigin + "/.well-known/oauth-protected-resource/mcp";

  function send(response: ServerResponse, status: number, code: string) {
    if (response.writableEnded || response.destroyed) return;
    response.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    response.end(JSON.stringify({ error: code }));
  }
  function challenge(response: ServerResponse, config: Config, scope = false) {
    response.setHeader(
      "WWW-Authenticate",
      `Bearer resource_metadata="${metadata}"${config.authMode === "bearer-jwt" ? ', scope="bb.read"' : ""}, error="${scope ? "insufficient_scope" : "invalid_token"}"`,
    );
    send(response, scope ? 403 : 401, scope ? "INSUFFICIENT_SCOPE" : "UNAUTHORIZED");
  }
  async function body(request: IncomingMessage) {
    const size = Number(request.headers["content-length"] ?? 0);
    if (!Number.isFinite(size) || size > bound.bodyBytes) throw new Error("BODY_TOO_LARGE");
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of request) {
      total += chunk.length;
      if (total > bound.bodyBytes) throw new Error("BODY_TOO_LARGE");
      chunks.push(Buffer.from(chunk));
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new Error("INVALID_JSON");
    }
  }
  async function handle(request: IncomingMessage, response: ServerResponse) {
    const id = randomUUID();
    let path: string;
    try {
      const url = new URL(request.url ?? "", resource);
      // There are no URL parameters, including credentials, on any route.
      if (
        url.search ||
        url.hash ||
        request.url !== url.pathname ||
        url.origin !== options.connection.publicOrigin
      )
        return send(response, 400, "INVALID_URL");
      path = url.pathname;
    } catch {
      return send(response, 400, "INVALID_URL");
    }
    if (path !== "/mcp" && !metadataPaths.has(path)) return send(response, 404, "NOT_FOUND");
    if (
      request.headers.host !== new URL(options.connection.publicOrigin).host ||
      (request.headers.origin !== undefined &&
        request.headers.origin !== options.connection.publicOrigin)
    )
      return send(response, 403, "UNTRUSTED_ORIGIN");
    // Forwarded headers never select the host, issuer, audience, or rate bucket.
    const config = options.policy();
    if (!config?.remoteEnabled) return send(response, 503, "ACCESS_DISABLED");
    if (Date.now() - windowStart >= 60000) {
      count = 0;
      windowStart = Date.now();
    }
    if (++count > bound.perMinute) {
      response.setHeader("Retry-After", "60");
      return send(response, 429, "RATE_LIMITED");
    }
    if (active >= bound.concurrent) return send(response, 503, "BUSY");
    active++;
    const controller = new AbortController();
    const context = { response, controller };
    requests.add(context);
    const timeout = setTimeout(() => {
      controller.abort();
      options.log({ request: id, code: "DEADLINE" });
      send(response, 504, "DEADLINE");
      request.destroy();
    }, bound.deadlineMs);
    const disconnect = () => {
      if (!response.writableFinished) controller.abort();
    };
    response.on("close", disconnect);
    let server: ReturnType<typeof projectServer> | undefined;
    let transport: WebStandardStreamableHTTPServerTransport | undefined;
    const releaseTransport = () => {
      void transport?.close();
      void server?.close();
    };
    controller.signal.addEventListener("abort", releaseTransport, { once: true });
    try {
      if (metadataPaths.has(path)) {
        if (request.method !== "GET") return send(response, 405, "METHOD_NOT_ALLOWED");
        response.writeHead(200, {
          "content-type": "application/json",
          "cache-control": "no-store",
        });
        response.end(
          JSON.stringify({
            resource,
            authorization_servers: [
              config.authMode === "cloudflare-access" ? config.accessOAuthIssuer : config.issuer,
            ],
            ...(config.authMode === "bearer-jwt"
              ? { scopes_supported: ["bb.read", "bb.control"] }
              : {}),
            bearer_methods_supported: ["header"],
          }),
        );
        return;
      }
      let identity;
      try {
        identity = await verify(request.headers, config, options.connection);
      } catch (error) {
        options.log({ request: id, code: "AUTH_REJECTED" });
        return challenge(
          response,
          config,
          error instanceof Error && error.message === "INSUFFICIENT_SCOPE",
        );
      }
      if (controller.signal.aborted || !hasAccess(options.policy(), identity))
        return send(response, 503, "ACCESS_DISABLED");
      if (request.method !== "POST") {
        response.setHeader("Allow", "POST");
        return send(response, 405, "METHOD_NOT_ALLOWED");
      }
      let parsed: unknown;
      if (request.method === "POST") {
        if (!/^application\/json(?:;|$)/i.test(request.headers["content-type"] ?? ""))
          return send(response, 415, "CONTENT_TYPE");
        parsed = await body(request);
      }
      if (controller.signal.aborted) return;
      if (!hasAccess(options.policy(), identity)) return send(response, 503, "ACCESS_DISABLED");
      server = projectServer(
        projects,
        threads,
        providers,
        options.policy,
        identity,
        controller.signal,
        (tool) =>
          options.log({
            request: id,
            code:
              tool === "bb_list_projects"
                ? "PROJECTS_UNAVAILABLE"
                : tool === "bb_list_providers"
                  ? "PROVIDERS_UNAVAILABLE"
                  : tool === "bb_start_thread" || tool === "bb_get_operation"
                    ? "OPERATION_UNAVAILABLE"
                    : "THREAD_UNAVAILABLE",
            tool,
          }),
        options.operations,
      );
      transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await server.connect(transport);
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (typeof value === "string") headers.set(name, value);
      }
      const result = await Promise.race([
        transport.handleRequest(
          new Request(resource, { method: request.method, headers, signal: controller.signal }),
          { parsedBody: parsed },
        ),
        new Promise<never>((_resolve, reject) =>
          controller.signal.addEventListener("abort", () => reject(new Error("REQUEST_ABORTED")), {
            once: true,
          }),
        ),
      ]);
      const text = await result.text();
      if (Buffer.byteLength(text) > bound.responseBytes)
        return send(response, 500, "RESPONSE_TOO_LARGE");
      if (controller.signal.aborted || response.writableEnded || response.destroyed) return;
      for (const [name, value] of result.headers) response.setHeader(name, value);
      response.setHeader("cache-control", "no-store");
      response.setHeader("x-content-type-options", "nosniff");
      response.writeHead(result.status);
      response.end(text);
    } catch (error) {
      const code =
        error instanceof Error && ["BODY_TOO_LARGE", "INVALID_JSON"].includes(error.message)
          ? error.message
          : "REQUEST_FAILED";
      options.log({ request: id, code });
      send(response, code === "BODY_TOO_LARGE" ? 413 : code === "INVALID_JSON" ? 400 : 500, code);
    } finally {
      clearTimeout(timeout);
      response.off("close", disconnect);
      controller.signal.removeEventListener("abort", releaseTransport);
      await transport?.close();
      await server?.close();
      requests.delete(context);
      active--;
    }
  }
  return {
    status: () => {
      const address = listener?.address();
      return {
        url: resource,
        port: address && typeof address === "object" ? address.port : options.connection.port,
        listener: state,
        publicReachability: "unverified" as const,
      };
    },
    async start() {
      if (listener || closing) throw new Error("LISTENER_ALREADY_STARTED");
      options.operations?.activate();
      state = "starting";
      listener = createServer({ maxHeaderSize: 16384 }, (req, res) => {
        void handle(req, res).catch(() => send(res, 500, "REQUEST_FAILED"));
      });
      listener.requestTimeout = bound.deadlineMs;
      listener.headersTimeout = bound.deadlineMs;
      listener.keepAliveTimeout = 1000;
      listener.maxConnections = 32;
      listener.on("clientError", (_error, socket) => {
        socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      });
      const instance = listener;
      try {
        starting = new Promise<void>((resolve, reject) => {
          instance.once("error", reject);
          instance.listen(options.connection.port, "127.0.0.1", () => {
            instance.off("error", reject);
            resolve();
          });
        });
        await starting;
        state = "listening";
      } catch {
        state = "error";
        listener = undefined;
        throw new Error("LISTENER_START_FAILED");
      } finally {
        starting = undefined;
      }
    },
    close(): Promise<void> {
      if (closing) return closing;
      closing = (async () => {
        await starting?.catch(() => {});
        const instance = listener;
        if (!instance) return;
        listener = undefined;
        for (const { response, controller } of requests) {
          controller.abort();
          send(response, 503, "ACCESS_DISABLED");
        }
        await new Promise<void>((resolve) => {
          instance.close(() => resolve());
          instance.closeAllConnections();
        });
        state = "stopped";
      })().finally(() => {
        closing = undefined;
      });
      return closing;
    },
  };
}
