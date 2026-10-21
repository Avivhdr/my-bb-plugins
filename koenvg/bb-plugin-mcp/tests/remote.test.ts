import { afterEach, describe, expect, it } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { request as httpRequest } from "node:http";
import { fixture, project } from "./fixtures.js";

let current: Awaited<ReturnType<typeof fixture>>;
afterEach(async () => {
  await current?.close();
});
async function setup(options: Parameters<typeof fixture>[0] = {}) {
  current = await fixture(options);
  return current;
}
const call = { name: "bb_list_projects", arguments: {} };

describe("authenticated HTTP boundary", () => {
  it("publishes cookie-free resource discovery and a usable OAuth challenge", async () => {
    const f = await setup();
    for (const path of [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
    ]) {
      const response = await f.request(path);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        resource: "https://mcp.example.org/mcp",
        authorization_servers: [f.policy().issuer],
        scopes_supported: ["bb.read", "bb.control"],
        bearer_methods_supported: ["header"],
      });
    }
    const rejected = await f.request();
    expect(rejected.status).toBe(401);
    expect(rejected.headers.get("www-authenticate")).toContain(
      'resource_metadata="https://mcp.example.org/.well-known/oauth-protected-resource/mcp"',
    );
    expect(f.list).not.toHaveBeenCalled();
  });

  it("uses a real MCP client for initialize, discovery, listing and reconnect", async () => {
    const f = await setup();
    for (let i = 0; i < 3; i++) {
      const client = await f.client();
      try {
        const tools = await client.listTools();
        expect(tools.tools.map((tool) => tool.name)).toEqual([
          "bb_list_projects",
          "bb_list_providers",
          "bb_list_threads",
          "bb_get_thread",
          "bb_start_thread",
          "bb_send_message",
          "bb_stop_thread",
          "bb_get_operation",
        ]);
        expect(tools.tools[0].annotations?.readOnlyHint).toBe(true);
        const result = await client.callTool(call);
        expect(result.structuredContent).toEqual({
          projects: [
            { id: "proj_a", name: "Allowed" },
            { id: "proj_hidden", name: "Private" },
          ],
          nextCursor: null,
        });
      } finally {
        await client.close();
      }
    }
    expect(f.issuerCalls).toEqual(["/realm/.well-known/openid-configuration", "/keys"]);
    expect(f.host.harness.inspection.sdk.calls.map((c) => c.path)).toEqual([
      "projects.list",
      "projects.list",
      "projects.list",
    ]);
  });

  it.each(["https://issuer.example.org/", "https://issuer.example.org/realm/"])(
    "authenticates a matching slash-ending issuer without changing metadata: %s",
    async (issuer) => {
      const f = await setup();
      f.change({ issuer });
      const metadata = await f.request("/.well-known/oauth-protected-resource/mcp");
      expect((await metadata.json()).authorization_servers).toEqual([issuer]);
      const client = await f.client();
      try {
        expect((await client.callTool(call)).structuredContent).toEqual({
          projects: [
            { id: "proj_a", name: "Allowed" },
            { id: "proj_hidden", name: "Private" },
          ],
          nextCursor: null,
        });
      } finally {
        await client.close();
      }
      expect(f.issuerCalls).toEqual([
        issuer.endsWith("/realm/")
          ? "/realm/.well-known/openid-configuration"
          : "/.well-known/openid-configuration",
        "/keys",
      ]);
      const reads = f.list.mock.calls.length;
      const mismatch = await f.token({ iss: issuer.slice(0, -1) });
      expect((await f.rpc("tools/call", call, mismatch)).status).toBe(401);
      expect(f.list.mock.calls).toHaveLength(reads);
    },
  );

  it("pages at most 50 ID/name records across all projects and applies live project deletion", async () => {
    const f = await setup();
    const records = Array.from({ length: 65 }, (_, i) => ({
      ...project(`proj_${String(i).padStart(3, "0")}`),
      secret: "private SDK field",
    }));
    f.list.mockResolvedValue([...records, project("proj_hidden", "Hidden")]);
    const client = await f.client();
    try {
      const first = (await client.callTool(call)).structuredContent as {
        projects: unknown[];
        nextCursor: string;
      };
      expect(first.projects).toHaveLength(50);
      expect(first.nextCursor).toBe("50");
      const second = (
        await client.callTool({ name: call.name, arguments: { cursor: first.nextCursor } })
      ).structuredContent as { projects: unknown[]; nextCursor: null };
      expect(second.projects).toHaveLength(16);
      expect(second.nextCursor).toBeNull();
      expect(JSON.stringify([first, second])).not.toMatch(/secret|private SDK field/);
      expect(second.projects.at(-1)).toEqual({ id: "proj_hidden", name: "Hidden" });
      f.list.mockResolvedValue([]);
      const calls = f.list.mock.calls.length;
      expect((await client.callTool(call)).structuredContent).toEqual({
        projects: [],
        nextCursor: null,
      });
      expect(f.list.mock.calls).toHaveLength(calls + 1);
      f.change({ controlEnabled: true });
      expect((await client.listTools()).tools).toHaveLength(8);
      const write = await client.callTool({
        name: "bb_start_thread",
        arguments: { projectId: "proj_a" },
      });
      expect(write.isError).toBe(true);
    } finally {
      await client.close();
    }
  });

  it.each([
    ["issuer", { iss: "https://wrong.example.org" }],
    ["audience", { aud: "https://other.example.org/mcp" }],
    ["owner", { sub: "not-owner" }],
    ["expired", { exp: 1 }],
    ["not yet valid", { nbf: 9999999999 }],
    ["scope", { scope: "bb.control" }],
    ["missing scope", { scope: undefined }],
  ])("rejects %s tokens before any BB operation", async (_name, claims) => {
    const f = await setup();
    const response = await f.rpc("tools/call", call, await f.token(claims));
    expect([401, 403]).toContain(response.status);
    expect(f.list).not.toHaveBeenCalled();
  });

  it("rejects forged, wrong-algorithm, unsigned and missing-expiry credentials", async () => {
    const f = await setup();
    const other = await generateKeyPair("RS256");
    const hs = await new SignJWT({
      iss: f.policy().issuer,
      aud: f.policy().publicOrigin + "/mcp",
      sub: "owner-1",
      scope: "bb.read",
      exp: 9999999999,
    })
      .setProtectedHeader({ alg: "HS256", kid: "fixture" })
      .sign(new Uint8Array(32));
    const noExpiry = await new SignJWT({
      iss: f.policy().issuer,
      aud: f.policy().publicOrigin + "/mcp",
      sub: "owner-1",
      scope: "bb.read",
    })
      .setProtectedHeader({ alg: "RS256", kid: "fixture" })
      .sign(f.signingKey);
    for (const token of [
      await f.token({}, other.privateKey),
      hs,
      "e30.e30.",
      noExpiry,
      "BB_PLUGIN_TOKEN",
    ]) {
      expect((await f.rpc("tools/call", call, token)).status).toBe(401);
    }
    expect(f.list).not.toHaveBeenCalled();
    expect(JSON.stringify(f.logs)).not.toContain(hs);
  });

  it("ignores key URLs in token headers and rejects URL credentials", async () => {
    const f = await setup();
    const credential = await f.token({}, undefined, {
      jku: "https://attacker.example.org/jwks",
      x5u: "https://attacker.example.org/cert",
    });
    expect((await f.rpc("tools/call", call, credential)).status).toBe(200);
    expect(f.issuerCalls).toEqual(["/realm/.well-known/openid-configuration", "/keys"]);
    expect((await f.request("/mcp?access_token=" + credential)).status).toBe(400);
    expect(JSON.stringify(f.logs)).not.toContain(credential);
  });

  it("checks live owner, issuer and access policy on subsequent protected requests", async () => {
    const f = await setup();
    const credential = await f.token();
    expect((await f.rpc("tools/list", {}, credential)).status).toBe(200);
    f.change({ owner: "someone-else" });
    expect((await f.rpc("tools/call", call, credential)).status).toBe(401);
    f.change({ owner: "owner-1", issuer: "https://new-issuer.example.org" });
    expect((await f.rpc("tools/call", call, credential)).status).toBe(401);
    f.change({ remoteEnabled: false });
    expect((await f.rpc("tools/call", call, credential)).status).toBe(503);
    expect(f.list).not.toHaveBeenCalled();
  });

  it("returns protocol errors, accepts notifications and needs no prior session", async () => {
    const f = await setup();
    expect((await f.rpc("tools/list")).status).toBe(200);
    const malformed = await f.request("/mcp", {
      method: "POST",
      headers: { authorization: "Bearer " + (await f.token()), "content-type": "application/json" },
      body: "{",
    });
    expect(malformed.status).toBe(400);
    expect(
      (await f.rpc("tools/list", {}, undefined, { "mcp-protocol-version": "1900-01-01" })).status,
    ).toBe(400);
    expect((await f.rpc("missing")).status).toBe(200);
    expect((await (await f.rpc("missing")).json()).error.code).toBe(-32601);
    for (const arguments_ of [{ limit: 51 }, { cursor: "../private" }, { extra: true }]) {
      const result = await (
        await f.rpc("tools/call", { name: call.name, arguments: arguments_ })
      ).json();
      expect(result.result.isError).toBe(true);
    }
    expect(f.list).not.toHaveBeenCalled();
    for (const method of ["GET", "DELETE", "PUT"]) {
      expect(
        (
          await f.request("/mcp", {
            method,
            headers: { authorization: "Bearer " + (await f.token()), accept: "text/event-stream" },
          })
        ).status,
      ).toBe(405);
    }
    expect(
      (
        await f.request("/mcp", {
          method: "POST",
          headers: {
            authorization: "Bearer " + (await f.token()),
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
        })
      ).status,
    ).toBe(202);
  });

  it("denies hostile hosts/origins and never forwards BB admin paths", async () => {
    const f = await setup();
    expect((await f.request("/api/v1/projects")).status).toBe(404);
    expect(
      (
        await f.request("/mcp", {
          headers: { host: "evil.example.org", "x-forwarded-host": "mcp.example.org" },
        })
      ).status,
    ).toBe(403);
    expect(
      (await f.request("/mcp", { headers: { origin: "https://evil.example.org" } })).status,
    ).toBe(403);
    const response = await f.request("/.well-known/oauth-protected-resource/mcp", {
      headers: {
        "x-forwarded-host": "evil.example.org",
        "x-forwarded-proto": "http",
        forwarded: "host=evil.example.org",
      },
    });
    expect((await response.json()).resource).toBe("https://mcp.example.org/mcp");
    expect(f.list).not.toHaveBeenCalled();
  });

  it("bounds both declared and streamed bodies", async () => {
    const f = await setup();
    const credential = await f.token();
    expect(
      (
        await f.request("/mcp", {
          method: "POST",
          headers: { authorization: "Bearer " + credential, "content-type": "application/json" },
          body: "x".repeat(65537),
        })
      ).status,
    ).toBe(413);
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        f.local + "/mcp",
        {
          method: "POST",
          headers: {
            host: "mcp.example.org",
            authorization: "Bearer " + credential,
            "content-type": "application/json",
            "transfer-encoding": "chunked",
          },
        },
        (response) => {
          response.resume();
          resolve(response.statusCode!);
        },
      );
      request.on("error", reject);
      request.write("x".repeat(40000));
      request.end("x".repeat(30000));
    });
    expect(status).toBe(413);
    expect(f.list).not.toHaveBeenCalled();
  });

  it("rate limits requests without trusting proxy IP headers", async () => {
    const f = await setup({ perMinute: 2 });
    for (let i = 0; i < 2; i++)
      expect((await f.request("/.well-known/oauth-protected-resource/mcp")).status).toBe(200);
    const response = await f.request("/.well-known/oauth-protected-resource/mcp", {
      headers: { "x-forwarded-for": "different" },
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
  });

  it("limits concurrent work, times out stalled BB calls and hides late output", async () => {
    const f = await setup({ concurrent: 1, deadlineMs: 150 });
    let release!: (value: ReturnType<typeof project>[]) => void;
    f.list.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = f.rpc("tools/call", call);
    await expect.poll(() => f.list.mock.calls.length).toBe(1);
    expect((await f.rpc("tools/list")).status).toBe(503);
    const response = await pending;
    expect(response.status).toBe(504);
    expect(await response.text()).not.toContain("Private");
    const stillBusy = await (await f.rpc("tools/call", call)).json();
    expect(stillBusy.result.isError).toBe(true);
    expect(f.list).toHaveBeenCalledTimes(1);
    release([project("proj_a", "Private late output")]);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(JSON.stringify(f.logs)).not.toContain("Private");
    expect((await f.rpc("tools/list")).status).toBe(200);
  });

  it("rechecks the owner during an in-flight read and hides SDK errors/oversized output", async () => {
    const f = await setup();
    f.list.mockImplementationOnce(async () => {
      f.change({ owner: "revoked-owner" });
      return [project("proj_a", "Private")];
    });
    const result = await (await f.rpc("tools/call", call)).json();
    expect(result.result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain("Private");
    f.change({ owner: "owner-1" });
    f.list.mockRejectedValueOnce(new Error("TOKEN and project secret"));
    const error = await (await f.rpc("tools/call", call)).text();
    expect(error).toContain("PROJECTS_UNAVAILABLE");
    expect(error).not.toContain("secret");
    f.list.mockResolvedValueOnce([project("proj_a", "x".repeat(65537))]);
    expect(await (await f.rpc("tools/call", call)).text()).toContain("PROJECTS_UNAVAILABLE");
    expect(JSON.stringify(f.logs)).not.toMatch(/TOKEN|secret|Private/);
  });

  it("releases its port repeatedly and closes active requests without a BB mutation", async () => {
    const f = await setup();
    for (let i = 0; i < 5; i++) {
      await f.access.close();
      await expect(f.request()).rejects.toThrow();
      expect(f.access.status().listener).toBe("stopped");
      await f.access.start();
      expect((await f.request("/.well-known/oauth-protected-resource/mcp")).status).toBe(200);
    }
    expect(f.host.harness.inspection.sdk.calls).toEqual([]);
  });

  it("closes transports during an active read and can rebind without waiting for BB", async () => {
    const f = await setup();
    let release!: (value: ReturnType<typeof project>[]) => void;
    f.list.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = f.rpc("tools/call", call);
    await expect.poll(() => f.list.mock.calls.length).toBe(1);
    await f.access.close();
    const response = await pending;
    expect([503]).toContain(response.status);
    await expect(f.request()).rejects.toThrow();
    await f.access.start();
    expect((await f.request("/.well-known/oauth-protected-resource/mcp")).status).toBe(200);
    release([project("proj_a", "Old output")]);
    expect(f.host.harness.inspection.sdk.calls.map((c) => c.path)).toEqual(["projects.list"]);
    expect(JSON.stringify(f.logs)).not.toContain("Old output");
  });

  it("refuses an oversized response and a wrong content type", async () => {
    const f = await setup({ responseBytes: 100 });
    expect((await f.rpc("tools/list")).status).toBe(500);
    const response = await f.request("/mcp", {
      method: "POST",
      headers: { authorization: "Bearer " + (await f.token()), "content-type": "text/plain" },
      body: "{}",
    });
    expect(response.status).toBe(415);
    expect(f.list).not.toHaveBeenCalled();
  });
});
