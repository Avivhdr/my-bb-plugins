import { createServer, request as httpRequest } from "node:http";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { vi } from "vitest";
import { remoteAccess, type limits } from "../remote-access.js";
import type { Config } from "../config.js";
import {
  operationControl,
  operationMigration,
  operationSubmissionMigration,
  operationStopMigration,
  operationResolutionMigration,
} from "../operations.js";
import { localOperationCommand, localOperationCommands } from "../local-operations.js";
import type { BbPluginApi } from "@get-bb/plugin-sdk";

const pair = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(pair.publicKey)), kid: "fixture", alg: "RS256", use: "sig" };

type Provider = Awaited<ReturnType<BbPluginApi["sdk"]["providers"]["list"]>>[number];
export function provider(
  id: string,
  modes: Provider["capabilities"]["permissionModes"] = ["auto", "accept-edits", "full"],
): Provider {
  return {
    id,
    displayName: `Name ${id}`,
    available: true,
    capabilities: {
      permissionModes: modes,
      modelCatalogScope: "host",
      supportsFork: false,
      supportsNativeUserQuestion: false,
      supportsServiceTier: false,
      supportsSessionRewind: false,
      supportsThreadArchive: false,
      supportsThreadRename: false,
    },
    completedTurnDisplay: "flat",
    composerActions: [],
    logoUrl: null,
    maintenance: { health: false, installation: false, usage: false },
    pluginId: "secret-plugin",
  };
}

// Node's built-in fetch does not preserve a supplied Host header. This test
// bridge uses a real TCP connection and keeps the tunnel's public Host.
export const loopbackFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  const body = request.body ? Buffer.from(await request.arrayBuffer()) : undefined;
  return new Promise<Response>((resolve, reject) => {
    const outgoing = httpRequest(
      request.url,
      {
        method: request.method,
        headers: Object.fromEntries(request.headers),
        signal: request.signal,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const headers = new Headers();
          for (const [key, value] of Object.entries(response.headers)) {
            if (typeof value === "string") headers.set(key, value);
            else if (value) headers.set(key, value.join(", "));
          }
          const status = response.statusCode ?? 500;
          resolve(
            new Response(status === 202 || status === 204 ? null : Buffer.concat(chunks), {
              status,
              headers,
            }),
          );
        });
        response.on("error", reject);
      },
    );
    outgoing.on("error", reject);
    outgoing.end(body);
  });
};
export async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}
export function project(id: string, name = id) {
  return {
    id,
    name,
    createdAt: 1,
    updatedAt: 1,
    kind: "standard" as const,
    gitRemoteUrl: null,
    sources: [],
  };
}
export async function fixture(
  overrides: Partial<typeof limits> = {},
  operationOptions: Pick<Parameters<typeof operationControl>[0], "now" | "limits"> = {},
  seedStorage?: (host: ReturnType<typeof createFakePluginHost>) => void,
  authMode: Config["authMode"] = "bearer-jwt",
) {
  let config: Config = {
    publicOrigin: "https://mcp.example.org",
    port: 0,
    issuer: "https://issuer.example.org" + (authMode === "bearer-jwt" ? "/realm" : ""),
    authMode,
    accessAudience: authMode === "cloudflare-access" ? "dedicated-app" : "",
    accessPermission: "read",
    accessOAuthIssuer: authMode === "cloudflare-access" ? "https://oauth.example.net" : "",
    owner: "owner-1",
    remoteEnabled: true,
    controlEnabled: false,
  };
  const issuerKeys = { keys: [{ ...jwk }] };
  const issuerCalls: string[] = [];
  const issuer = createServer((req, res) => {
    issuerCalls.push(req.url ?? "");
    res.setHeader("content-type", "application/json");
    if (
      req.url === "/realm/.well-known/openid-configuration" ||
      req.url === "/.well-known/openid-configuration"
    )
      res.end(
        JSON.stringify({
          issuer: config.issuer,
          jwks_uri: "https://issuer.example.org/keys",
          authorization_endpoint: "https://issuer.example.org/authorize",
          token_endpoint: "https://issuer.example.org/token",
          code_challenge_methods_supported: ["S256"],
        }),
      );
    else if (req.url === "/keys" || req.url === "/cdn-cgi/access/certs")
      res.end(JSON.stringify(issuerKeys));
    else {
      res.statusCode = 404;
      res.end("{}");
    }
  });
  await new Promise<void>((resolve) => issuer.listen(0, "127.0.0.1", resolve));
  const address = issuer.address();
  if (!address || typeof address === "string") throw new Error();
  const fetchIssuer: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.origin !== "https://issuer.example.org") throw new Error("Unexpected issuer URL");
    return fetch(`http://127.0.0.1:${address.port}${url.pathname}`, init);
  };
  let host = createFakePluginHost();
  seedStorage?.(host);
  const list = vi.fn(async () => [project("proj_a", "Allowed"), project("proj_hidden", "Private")]);
  host.harness.sdk.stub("projects.list", list);
  const logs: unknown[] = [];
  function createAccess() {
    const db = host.bb.storage.database();
    host.bb.storage.migrate(db, [
      operationMigration,
      operationSubmissionMigration,
      operationStopMigration,
      operationResolutionMigration,
    ]);
    const operations = operationControl({
      db,
      policy: () => config,
      ...operationOptions,
      source: {
        defaults: (args) => host.bb.sdk.projects.defaultExecutionOptions(args),
        listProviders: (args) => host.bb.sdk.providers.list(args),
        systemConfig: (args) => host.bb.sdk.system.config(args),
        spawn: (args) => host.bb.sdk.threads.spawn(args),
        get: (args) => host.bb.sdk.threads.get(args),
        send: (args) => host.bb.sdk.threads.send(args),
        stop: (args) => host.bb.sdk.threads.stop(args),
        queue: (args) => host.bb.sdk.threads.queuedMessages.list(args),
        interactions: (args) => host.bb.sdk.threads.interactions.list(args),
      },
    });
    host.bb.cli.register({
      name: "mcp",
      summary: "Synthetic local operation fixture",
      commands: localOperationCommands,
      run: (argv) => localOperationCommand(operations, argv),
    });
    const access = remoteAccess({
      connection: config,
      policy: () => config,
      projects: host.bb.sdk.projects,
      providers: host.bb.sdk.providers,
      threads: host.bb.sdk.threads,
      operations,
      fetch: fetchIssuer,
      log: (event) => logs.push(event),
      limits: overrides,
    });
    return { operations, access };
  }
  let { operations, access } = createAccess();
  await access.start();
  // Keep the OS-assigned port bound instead of releasing a probe before startup.
  config.port = access.status().port;
  const local = `http://127.0.0.1:${config.port}`;
  async function token(
    claims: JWTPayload = {},
    key = pair.privateKey,
    header: Record<string, unknown> = {},
  ) {
    return new SignJWT({
      ...(config.authMode === "cloudflare-access" ? { type: "app" } : { scope: "bb.read" }),
      ...claims,
    })
      .setProtectedHeader({ alg: "RS256", kid: "fixture", ...header })
      .setIssuer(typeof claims.iss === "string" ? claims.iss : config.issuer)
      .setSubject(typeof claims.sub === "string" ? claims.sub : config.owner)
      .setAudience(
        claims.aud ??
          (config.authMode === "cloudflare-access"
            ? config.accessAudience
            : config.publicOrigin + "/mcp"),
      )
      .setExpirationTime(claims.exp ?? Math.floor(Date.now() / 1000) + 300)
      .sign(key);
  }
  async function request(path = "/mcp", init: RequestInit = {}) {
    return loopbackFetch(local + path, {
      ...init,
      headers: { host: "mcp.example.org", ...Object.fromEntries(new Headers(init.headers)) },
    });
  }
  async function rpc(
    method: string,
    params: unknown = {},
    credential?: string,
    headers: Record<string, string> = {},
  ) {
    return request("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(config.authMode === "cloudflare-access"
          ? {
              "cf-access-jwt-assertion": credential ?? (await token()),
              authorization: "Bearer opaque-client-token",
            }
          : { authorization: "Bearer " + (credential ?? (await token())) }),
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
  }
  async function client() {
    const instance = new Client({ name: "boundary-test", version: "1" });
    const credential = await token();
    const transport = new StreamableHTTPClientTransport(new URL(local + "/mcp"), {
      requestInit: {
        headers:
          config.authMode === "cloudflare-access"
            ? { "cf-access-jwt-assertion": credential, authorization: "Bearer opaque-client-token" }
            : { authorization: "Bearer " + credential },
      },
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set("host", "mcp.example.org");
        return loopbackFetch(input, { ...init, headers });
      },
    });
    await instance.connect(transport);
    return instance;
  }
  return {
    signingKey: pair.privateKey,
    get access() {
      return access;
    },
    get host() {
      return host;
    },
    list,
    logs,
    issuerCalls,
    issuerKeys,
    token,
    rpc,
    request,
    client,
    local,
    policy: () => config,
    change: (next: Partial<Config>) => {
      config = { ...config, ...next };
    },
    async restart(crash = false) {
      await access.close();
      if (!crash) operations.close();
      host = await host.harness.lifecycle.reload(async () => {});
      ({ operations, access } = createAccess());
      await access.start();
    },
    async close() {
      await access.close();
      operations.close();
      await host.harness.lifecycle.dispose();
      issuer.closeAllConnections();
      await new Promise<void>((resolve) => issuer.close(() => resolve()));
    },
  };
}
