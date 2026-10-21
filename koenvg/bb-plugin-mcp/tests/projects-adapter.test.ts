import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import plugin from "../server.js";
import { freePort, loopbackFetch, project, provider } from "./fixtures.js";

let host: ReturnType<typeof createFakePluginHost>;
let client: Client | undefined;
afterEach(async () => {
  await client?.close();
  client = undefined;
  await host?.harness.lifecycle.dispose();
  vi.unstubAllGlobals();
});

const personal = { ...project("proj_personal", "Personal"), kind: "personal" as const };
const ordinary = project("proj_a", "Ordinary");
const call = { name: "bb_list_projects", arguments: {} };

// Load the production plugin, not a copy of its SDK adapter. Only the issuer
// fetch and BB data are fixtures; MCP requests use the real loopback listener.
async function setup(
  authMode: "bearer-jwt" | "cloudflare-access",
  projects: string,
  control = false,
) {
  const settings = {
    publicOrigin: "https://mcp.example.org",
    port: await freePort(),
    issuer: "https://issuer.example.org",
    owner: "owner",
    projects,
    remoteEnabled: true,
    controlEnabled: true,
    authMode,
    accessAudience: "dedicated-app",
    accessPermission: control ? "read-control" : "read",
    accessOAuthIssuer: "https://oauth.example.org",
  };
  const pair = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: "fixture", alg: "RS256", use: "sig" };
  vi.stubGlobal("fetch", async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (url === settings.issuer + "/.well-known/openid-configuration") {
      return Response.json({ issuer: settings.issuer, jwks_uri: settings.issuer + "/keys" });
    }
    if (url === settings.issuer + "/keys" || url === settings.issuer + "/cdn-cgi/access/certs") {
      return Response.json({ keys: [jwk] });
    }
    throw new Error("Unexpected external fetch: " + url);
  });
  host = createFakePluginHost({ settings });
  const list = vi.fn<typeof host.bb.sdk.projects.list>(async (args) => {
    const records = [
      personal,
      project("proj_hidden", "Hidden"),
      ordinary,
      project("proj_z", "Personal"),
    ];
    return args?.includePersonal ? records : records.filter((p) => p.kind !== "personal");
  });
  host.harness.sdk.stub("projects.list", list);
  await plugin(host.bb);
  host.harness.behavior.runService("listener");
  await expect
    .poll(async () => {
      const status = await host.harness.behavior.runCli(["status", "--json"]);
      return JSON.parse(status.stdout ?? "{}").listener;
    })
    .toBe("listening");

  const token = await new SignJWT({
    iss: settings.issuer,
    sub: settings.owner,
    aud:
      authMode === "cloudflare-access" ? settings.accessAudience : settings.publicOrigin + "/mcp",
    scope: control ? "bb.read bb.control" : "bb.read",
    type: "app",
    exp: Math.floor(Date.now() / 1000) + 900,
  })
    .setProtectedHeader({ alg: "RS256", kid: "fixture" })
    .sign(pair.privateKey);
  client = new Client({ name: "adapter-fixture", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${settings.port}/mcp`), {
      fetch: loopbackFetch,
      requestInit: {
        headers: {
          host: "mcp.example.org",
          ...(authMode === "cloudflare-access"
            ? { "cf-access-jwt-assertion": token }
            : { authorization: "Bearer " + token }),
        },
      },
    }),
  );
  return { client, list };
}

describe.each(["bearer-jwt", "cloudflare-access"] as const)(
  "%s production project adapter",
  (mode) => {
    const discovered = [
      { id: "proj_a", name: "Ordinary" },
      { id: "proj_hidden", name: "Hidden" },
      { id: "proj_z", name: "Personal" },
    ];

    it("discovers providers through the production primary-host adapter with read-only access", async () => {
      const f = await setup(mode, "");
      const providers = vi.fn<typeof host.bb.sdk.providers.list>(async () => [
        provider("pi", ["full"]),
      ]);
      host.harness.sdk.stub("providers.list", providers);
      const result = await f.client.callTool({
        name: "bb_list_providers",
        arguments: { projectId: "proj_a" },
      });
      const data = {
        providers: [
          { id: "pi", displayName: "Name pi", available: true, permissionModes: ["full"] },
        ],
      };
      expect(result).toEqual({
        content: [{ type: "text", text: JSON.stringify(data) }],
        structuredContent: data,
      });
      expect(f.list.mock.calls).toEqual([[{ includePersonal: false }]]);
      expect(providers.mock.calls).toEqual([[{ signal: expect.any(AbortSignal) }]]);
    });

    it("sanitizes provider and project failures and denies Personal and nonexistent projects", async () => {
      const f = await setup(mode, "");
      const providers = vi.fn<typeof host.bb.sdk.providers.list>(async () => {
        throw new Error("private provider data");
      });
      host.harness.sdk.stub("providers.list", providers);
      const denied = { isError: true, content: [{ type: "text", text: "PROVIDERS_UNAVAILABLE" }] };
      for (const projectId of ["proj_personal", "proj_missing", "proj_a"])
        expect(
          await f.client.callTool({ name: "bb_list_providers", arguments: { projectId } }),
        ).toEqual(denied);
      expect(providers).toHaveBeenCalledTimes(1);
      f.list.mockRejectedValue(new Error("private project data"));
      expect(
        await f.client.callTool({ name: "bb_list_providers", arguments: { projectId: "proj_a" } }),
      ).toEqual(denied);
      expect(providers).toHaveBeenCalledTimes(1);
    });

    it("wires explicit and omitted starts through the production SDK adapter", async () => {
      const f = await setup(mode, "", true);
      const defaults = {
        providerId: "saved",
        model: "saved-model",
        permissionMode: "full" as const,
        reasoningLevel: "medium" as const,
        serviceTier: "saved-tier",
      };
      const providers = vi.fn<typeof host.bb.sdk.providers.list>(async () => [
        provider("saved", ["full"]),
        provider("pi", ["full"]),
      ]);
      const readDefaults = vi.fn<typeof host.bb.sdk.projects.defaultExecutionOptions>(
        async () => defaults,
      );
      const spawn = vi.fn<typeof host.bb.sdk.threads.spawn>(async () =>
        makeThreadResponse({ id: "thr_adapter", projectId: "proj_a" }),
      );
      host.harness.sdk.stub("providers.list", providers);
      host.harness.sdk.stub("projects.defaultExecutionOptions", readDefaults);
      host.harness.sdk.stub("threads.spawn", spawn);
      host.harness.sdk.stub("threads.get", async () =>
        makeThreadResponse({ id: "thr_adapter", projectId: "proj_a" }),
      );
      for (const providerId of [undefined, "saved", "pi"]) {
        const result = await f.client.callTool({
          name: "bb_start_thread",
          arguments: {
            projectId: "proj_a",
            prompt: "Synthetic adapter",
            operationKey: `adapter-${providerId ?? "omitted"}`,
            ...(providerId === undefined ? {} : { providerId }),
          },
        });
        expect(result.structuredContent).toMatchObject({
          state: "accepted",
          threadId: "thr_adapter",
        });
        expect(spawn.mock.calls.at(-1)?.[0]).toEqual({
          ...(providerId === "pi" ? { providerId: "pi", permissionMode: "full" } : defaults),
          projectId: "proj_a",
          prompt: "Synthetic adapter",
          environment: { type: "project-default" },
          visibility: "visible",
          pluginMetadata: {
            operationId: (result.structuredContent as { operationId: string }).operationId,
          },
          origin: "plugin",
          originPluginId: "test-plugin",
        });
      }
      expect(providers.mock.calls).toEqual([
        [{ signal: expect.any(AbortSignal) }],
        [{ signal: expect.any(AbortSignal) }],
      ]);
      expect(readDefaults.mock.calls).toEqual(
        Array.from({ length: 3 }, () => [{ projectId: "proj_a", signal: expect.any(AbortSignal) }]),
      );
      expect(f.list).not.toHaveBeenCalled();
    });

    it.each([undefined, "project-folder", "worktree"] as const)(
      "forwards the production %s workspace selection and config signal",
      async (workspace) => {
        const f = await setup(mode, "", true);
        const readConfig = vi.fn<typeof host.bb.sdk.system.config>(
          async () =>
            ({ primaryHostId: "host_adapter" }) as Awaited<
              ReturnType<typeof host.bb.sdk.system.config>
            >,
        );
        const readDefaults = vi.fn<typeof host.bb.sdk.projects.defaultExecutionOptions>(
          async () => ({
            providerId: "adapter-provider",
            model: "adapter-model",
            permissionMode: "auto",
            reasoningLevel: "high",
            serviceTier: "priority",
          }),
        );
        const spawn = vi.fn<typeof host.bb.sdk.threads.spawn>(async () =>
          makeThreadResponse({ id: "thr_adapter", projectId: "proj_a" }),
        );
        host.harness.sdk.stub("system.config", readConfig);
        host.harness.sdk.stub("projects.defaultExecutionOptions", readDefaults);
        host.harness.sdk.stub("threads.spawn", spawn);
        host.harness.sdk.stub("threads.get", async () =>
          makeThreadResponse({ id: "thr_adapter", projectId: "proj_a" }),
        );
        const result = await f.client.callTool({
          name: "bb_start_thread",
          arguments: {
            projectId: "proj_a",
            prompt: "Adapter fixture",
            operationKey: "adapter-workspace",
            ...(workspace ? { workspace } : {}),
          },
        });
        expect(result.structuredContent).toMatchObject({
          state: "accepted",
          threadId: "thr_adapter",
          code: null,
        });
        expect(spawn.mock.calls).toEqual([
          [
            {
              providerId: "adapter-provider",
              model: "adapter-model",
              permissionMode: "auto",
              reasoningLevel: "high",
              serviceTier: "priority",
              projectId: "proj_a",
              prompt: "Adapter fixture",
              visibility: "visible",
              environment:
                workspace === undefined
                  ? { type: "project-default" }
                  : workspace === "project-folder"
                    ? {
                        type: "host",
                        hostId: "host_adapter",
                        workspace: { type: "unmanaged", path: null },
                      }
                    : {
                        type: "host",
                        hostId: "host_adapter",
                        workspace: { type: "managed-worktree", baseBranch: { kind: "default" } },
                      },
              pluginMetadata: {
                operationId: (result.structuredContent as Record<string, unknown>).operationId,
              },
              origin: "plugin",
              originPluginId: "test-plugin",
            },
          ],
        ]);
        expect(readConfig.mock.calls).toEqual(
          workspace ? [[{ signal: expect.any(AbortSignal) }]] : [],
        );
        expect(host.harness.inspection.sdk.calls.map((c) => c.path)).toEqual([
          "projects.defaultExecutionOptions",
          ...(workspace ? ["system.config"] : []),
          "threads.spawn",
          "threads.get",
        ]);
      },
    );

    it("denies production read-only workspace starts before defaults or config", async () => {
      const f = await setup(mode, "");
      const result = await f.client.callTool({
        name: "bb_start_thread",
        arguments: {
          projectId: "proj_a",
          prompt: "Adapter fixture",
          operationKey: "denied-workspace",
          workspace: "worktree",
        },
      });
      expect(result).toMatchObject({
        isError: true,
        content: [{ type: "text", text: "OPERATION_UNAVAILABLE" }],
      });
      expect(host.harness.inspection.sdk.calls.map((c) => c.path)).toEqual([]);
    });
    it.each([
      "proj_a",
      "proj_personal\nproj_a",
      "proj_personal",
      "proj_a\nproj_personal_other",
      "",
    ])("discovers standard projects regardless of obsolete grants: %j", async (projects) => {
      const f = await setup(mode, projects);
      expect((await f.client.callTool(call)).structuredContent).toEqual({
        projects: discovered,
        nextCursor: null,
      });
      expect(f.list.mock.calls).toEqual([[{ includePersonal: false }]]);
      expect(host.harness.inspection.sdk.calls.map((c) => c.path)).toEqual(["projects.list"]);
    });

    it("preserves pagination, ID order and project-only fields", async () => {
      const f = await setup(mode, "");
      expect(
        (await f.client.callTool({ name: call.name, arguments: { limit: 2 } })).structuredContent,
      ).toEqual({ projects: discovered.slice(0, 2), nextCursor: "2" });
      expect(
        (await f.client.callTool({ name: call.name, arguments: { limit: 2, cursor: "2" } }))
          .structuredContent,
      ).toEqual({ projects: discovered.slice(2), nextCursor: null });
      expect(f.list.mock.calls).toEqual([
        [{ includePersonal: false }],
        [{ includePersonal: false }],
      ]);
    });

    it("discovers newly created projects on the next request without a settings edit", async () => {
      const f = await setup(mode, "proj_a");
      expect((await f.client.callTool(call)).structuredContent).toEqual({
        projects: discovered,
        nextCursor: null,
      });
      f.list.mockResolvedValueOnce([personal, ordinary, project("proj_future", "Future")]);
      expect((await f.client.callTool(call)).structuredContent).toEqual({
        projects: [
          { id: "proj_a", name: "Ordinary" },
          { id: "proj_future", name: "Future" },
        ],
        nextCursor: null,
      });
    });

    it("ignores obsolete grants while excluding Personal from discovery and controls", async () => {
      const f = await setup(mode, "proj_personal\nproj_a");
      f.list.mockImplementationOnce(async () => {
        return [personal, ordinary];
      });
      expect((await f.client.callTool(call)).structuredContent).toEqual({
        projects: [{ id: "proj_a", name: "Ordinary" }],
        nextCursor: null,
      });
      const threads = await f.client.callTool({
        name: "bb_list_threads",
        arguments: { projectId: "proj_personal" },
      });
      expect(threads.isError).toBe(true);
      const denied = await f.client.callTool({
        name: "bb_start_thread",
        arguments: {
          projectId: "proj_personal",
          prompt: "Fixture only",
          operationKey: "personal-start",
        },
      });
      expect(denied.isError).toBe(true);
      expect(host.harness.inspection.sdk.calls.map((c) => c.path)).toEqual(["projects.list"]);
    });

    it("rechecks the owner after the SDK read before returning project names", async () => {
      const f = await setup(mode, "");
      f.list.mockImplementationOnce(async () => {
        await host.harness.behavior.setSettings({ owner: "another-owner" });
        return [personal];
      });
      const result = await f.client.callTool(call);
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).not.toContain("Personal");
      expect(f.list.mock.calls).toEqual([[{ includePersonal: false }]]);
    });
  },
);
