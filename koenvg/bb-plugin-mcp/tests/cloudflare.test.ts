import { afterEach, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { authenticator } from "../auth.js";
import { fixture } from "./fixtures.js";

let f: Awaited<ReturnType<typeof fixture>>;
afterEach(async () => {
  vi.restoreAllMocks();
  await f?.close();
});
async function setup() {
  f = await fixture({}, {}, undefined, "cloudflare-access");
  return f;
}
function claims(): JWTPayload {
  return {
    iss: f.policy().issuer,
    sub: f.policy().owner,
    aud: f.policy().accessAudience,
    type: "app",
    exp: Math.floor(Date.now() / 1000) + 900,
  };
}
async function signed(changes: Record<string, unknown> = {}) {
  return new SignJWT({ ...claims(), ...changes })
    .setProtectedHeader({ alg: "RS256", kid: "fixture" })
    .sign(f.signingKey);
}
const start = { projectId: "proj_a", prompt: "Synthetic work only", operationKey: "access-start" };
async function call(name: string, args: object, token?: string) {
  return (await (await f.rpc("tools/call", { name, arguments: args }, token)).json()).result;
}
function unavailable(result: unknown) {
  expect(result).toMatchObject({
    isError: true,
    content: [{ type: "text", text: "OPERATION_UNAVAILABLE" }],
  });
}
function defaults() {
  return {
    providerId: "fixture",
    model: "fixture-model",
    permissionMode: "accept-edits" as const,
    reasoningLevel: "medium" as const,
    serviceTier: "default" as const,
  };
}
function stubStart() {
  const spawn = vi.fn<typeof f.host.bb.sdk.threads.spawn>(async () =>
    makeThreadResponse({ id: "thr_cf", projectId: "proj_a" }),
  );
  const readDefaults = vi.fn(async () => defaults());
  f.host.harness.sdk.stub("threads.spawn", spawn);
  f.host.harness.sdk.stub("projects.defaultExecutionOptions", readDefaults);
  f.host.harness.sdk.stub("threads.get", async () =>
    makeThreadResponse({ id: "thr_cf", projectId: "proj_a" }),
  );
  return { spawn, readDefaults };
}

it("uses the official MCP client and exact app assertion for reads, with truthful annotations", async () => {
  await setup();
  const client = await f.client();
  try {
    expect(
      (await client.callTool({ name: "bb_list_projects", arguments: {} })).structuredContent,
    ).toEqual({
      projects: [
        { id: "proj_a", name: "Allowed" },
        { id: "proj_hidden", name: "Private" },
      ],
      nextCursor: null,
    });
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === "bb_start_thread")).toMatchObject({
      description: expect.stringContaining("local read-control permission"),
      annotations: { readOnlyHint: false, destructiveHint: true },
    });
    expect(tools.find((t) => t.name === "bb_get_operation")?.annotations?.readOnlyHint).toBe(true);
    expect(f.issuerCalls).toEqual(["/cdn-cgi/access/certs"]);
  } finally {
    await client.close();
  }
});

it("keeps the OAuth discovery issuer separate and does not advertise invented scopes", async () => {
  await setup();
  const response = await f.request("/.well-known/oauth-protected-resource/mcp");
  expect(await response.json()).toEqual({
    resource: "https://mcp.example.org/mcp",
    authorization_servers: ["https://oauth.example.net"],
    bearer_methods_supported: ["header"],
  });
  const denial = await f.request();
  expect(denial.status).toBe(401);
  expect(denial.headers.get("www-authenticate")).not.toContain("bb.read");
  expect(f.host.harness.inspection.sdk.calls).toEqual([]);
});

it.each([
  { sub: "another-owner" },
  { sub: "" },
  { aud: "bb-admin-app" },
  { aud: ["local-share-app"] },
  { iss: "https://attacker.example.net" },
  { type: "org" },
  { type: undefined },
  { exp: 1 },
  { exp: undefined },
  { sub: undefined },
  { iss: undefined },
  { aud: undefined },
  { nbf: Math.floor(Date.now() / 1000) + 3600 },
  { iat: Math.floor(Date.now() / 1000) + 3600 },
  { iat: "invalid" },
  { exp: "invalid" },
  { nbf: "invalid" },
  { sub: "", common_name: "service-token-client" },
])("refuses invalid signed application claims without any BB calls: %j", async (changes) => {
  await setup();
  const token = await signed(changes);
  expect((await f.rpc("tools/list", {}, token)).status).toBe(401);
  expect(f.host.harness.inspection.sdk.calls).toEqual([]);
  expect(JSON.stringify(f.logs)).not.toContain(token);
});

it("refuses unknown keys, wrong signatures, unsigned tokens and wrong algorithms", async () => {
  await setup();
  const other = await generateKeyPair("RS256");
  const tokens = [
    await f.token({}, other.privateKey),
    await f.token({}, f.signingKey, { kid: "unknown" }),
    await f.token({}, f.signingKey, { kid: undefined }),
    await new SignJWT(claims())
      .setProtectedHeader({ alg: "HS256", kid: "fixture" })
      .sign(new Uint8Array(32)),
    Buffer.from(JSON.stringify({ alg: "none", kid: "fixture" })).toString("base64url") +
      "." +
      Buffer.from(JSON.stringify(claims())).toString("base64url") +
      ".",
  ];
  for (const token of tokens) expect((await f.rpc("tools/list", {}, token)).status).toBe(401);
  expect(f.host.harness.inspection.sdk.calls).toEqual([]);
});

it("never falls back to bearer, cookies, forwarding claims or a combined assertion", async () => {
  await setup();
  const valid = await f.token();
  for (const headers of [
    { authorization: "Bearer " + valid },
    { cookie: "CF_Authorization=" + valid },
    { "x-forwarded-user": "owner-1", "cf-access-authenticated-user-email": "owner@example.net" },
    { "cf-access-jwt-assertion": valid + ", " + valid },
    { "cf-access-jwt-assertion": "malformed" },
    { "cf-access-jwt-assertion": "a".repeat(8193) },
  ] as Record<string, string>[])
    expect((await f.request("/mcp", { headers })).status).toBe(401);
  expect(f.host.harness.inspection.sdk.calls).toEqual([]);
  f.change({ authMode: "bearer-jwt" });
  expect((await f.request("/mcp", { headers: { "cf-access-jwt-assertion": valid } })).status).toBe(
    401,
  );
  const bearer = await f.token();
  expect(
    (await f.rpc("tools/list", {}, bearer, { "cf-access-jwt-assertion": "invalid" })).status,
  ).toBe(200);
  expect(f.issuerCalls).toContain("/.well-known/openid-configuration");
});

it("ignores token-selected key URLs and caches only trusted configured key sources", async () => {
  await setup();
  const token = await f.token({}, f.signingKey, {
    jku: "https://attacker.invalid/keys",
    x5u: "https://attacker.invalid/cert",
  });
  expect((await f.rpc("tools/list", {}, token)).status).toBe(200);
  expect((await f.rpc("tools/list", {}, token)).status).toBe(200);
  expect(f.issuerCalls).toEqual(["/cdn-cgi/access/certs"]);
  const identity = await authenticator(async () => new Response(JSON.stringify(f.issuerKeys)))(
    { "cf-access-jwt-assertion": token },
    f.policy(),
    f.policy(),
  );
  expect(identity).toEqual({
    mode: "cloudflare-access",
    issuer: f.policy().issuer,
    owner: "owner-1",
    audience: "dedicated-app",
    permissions: ["read"],
    expiresAt: expect.any(Number),
  });
  expect(JSON.stringify(identity)).not.toContain(token);
  expect(identity).not.toHaveProperty("scopes");
});

it("accepts current/previous keys after bounded cache expiry and refuses unavailable/oversized keys", async () => {
  await setup();
  const previous = await signed();
  expect((await f.rpc("tools/list", {}, previous)).status).toBe(200);
  const next = await generateKeyPair("RS256");
  f.issuerKeys.keys.push({
    ...(await exportJWK(next.publicKey)),
    alg: "RS256",
    use: "sig",
    kid: "rotated",
  });
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 300001);
  const current = await f.token({}, next.privateKey, { kid: "rotated" });
  expect((await f.rpc("tools/list", {}, current)).status).toBe(200);
  expect((await f.rpc("tools/list", {}, previous)).status).toBe(200);
  expect(f.issuerCalls).toEqual(["/cdn-cgi/access/certs", "/cdn-cgi/access/certs"]);
  vi.restoreAllMocks();
  for (const response of [
    new Response("{}", { status: 503 }),
    new Response("x".repeat(32769)),
    new Response("bad-json"),
  ]) {
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      expect(init?.redirect).toBe("error");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return response;
    });
    await expect(
      authenticator(fetcher)({ "cf-access-jwt-assertion": previous }, f.policy(), f.policy()),
    ).rejects.toThrow();
    expect(fetcher.mock.calls[0]?.[0].toString()).toBe(
      "https://issuer.example.org/cdn-cgi/access/certs",
    );
  }
});

it.each([
  { accessPermission: "read" as const, controlEnabled: true },
  { accessPermission: "read-control" as const, controlEnabled: false },
])("requires both explicit app control permission and local control: %j", async (policy) => {
  await setup();
  f.change(policy);
  const token = await f.token({ scope: "bb.read bb.control", permissions: ["control"] });
  for (const [name, args] of [
    ["bb_start_thread", start],
    ["bb_send_message", { threadId: "thr_cf", message: "Synthetic", operationKey: "cf-send" }],
    ["bb_stop_thread", { threadId: "thr_cf", operationKey: "cf-stop" }],
  ] as const)
    unavailable(await call(name, args, token));
  expect(f.host.harness.inspection.sdk.calls).toEqual([]);
});

it("shares the local owner/app permission across grants and protects cached results and persisted keys", async () => {
  await setup();
  const firstGrant = await signed({ nonce: "grant-one" });
  const secondGrant = await signed({ nonce: "grant-two" });
  const { spawn } = stubStart();
  f.change({ controlEnabled: true });
  unavailable(await call("bb_start_thread", start, firstGrant));
  unavailable(await call("bb_start_thread", start, secondGrant));
  expect(spawn).not.toHaveBeenCalled();
  f.change({ accessPermission: "read-control" });
  const accepted = (await call("bb_start_thread", start, firstGrant)).structuredContent;
  expect(accepted).toMatchObject({ state: "accepted", threadId: "thr_cf" });
  expect((await call("bb_start_thread", start, secondGrant)).structuredContent).toEqual(accepted);
  expect(spawn).toHaveBeenCalledTimes(1);
  f.change({ accessPermission: "read", controlEnabled: false });
  unavailable(await call("bb_start_thread", start, firstGrant));
  expect(
    (await call("bb_get_operation", { operationId: accepted.operationId }, secondGrant))
      .structuredContent,
  ).toEqual(accepted);
  await f.restart();
  f.host.harness.sdk.stub("threads.get", async () =>
    makeThreadResponse({ id: "thr_cf", projectId: "proj_a" }),
  );
  expect(
    (await call("bb_get_operation", { operationId: accepted.operationId }, firstGrant))
      .structuredContent,
  ).toEqual(accepted);
  f.change({ accessPermission: "read-control", controlEnabled: true });
  expect((await call("bb_start_thread", start, secondGrant)).structuredContent).toEqual(accepted);
  expect(
    f.host.harness.inspection.sdk.calls.filter((c) => c.path === "threads.spawn"),
  ).toHaveLength(0);
});

it.each(["bb_send_message", "bb_stop_thread"])(
  "keeps ordinary BB arguments and duplicate guards for %s",
  async (name) => {
    await setup();
    f.change({ controlEnabled: true, accessPermission: "read-control" });
    f.host.harness.sdk.stub("threads.get", async () =>
      makeThreadResponse({ id: "thr_cf", projectId: "proj_a" }),
    );
    f.host.harness.sdk.stub("threads.queuedMessages.list", async () => []);
    f.host.harness.sdk.stub("threads.interactions.list", async () => []);
    f.host.harness.sdk.stub("threads.send", async () => ({ ok: true, delivery: "sent" }));
    f.host.harness.sdk.stub("threads.stop", async () => ({ ok: true }));
    const args = {
      threadId: "thr_cf",
      operationKey: name + "-1",
      ...(name === "bb_send_message" ? { message: "Synthetic" } : {}),
    };
    const accepted = (await call(name, args)).structuredContent;
    expect(accepted.state).toBe("accepted");
    expect((await call(name, args)).structuredContent).toEqual(accepted);
    const dispatch = f.host.harness.inspection.sdk.calls.filter(
      (c) => c.path === (name === "bb_send_message" ? "threads.send" : "threads.stop"),
    );
    expect(dispatch).toHaveLength(1);
    expect(dispatch[0]?.args[0]).toEqual(
      name === "bb_send_message"
        ? {
            threadId: "thr_cf",
            input: [{ type: "text", text: "Synthetic", mentions: [] }],
            mode: "auto",
          }
        : { threadId: "thr_cf" },
    );
  },
);

it.each([
  { accessPermission: "read" as const },
  { controlEnabled: false },
  { accessAudience: "another-app" },
  { authMode: "bearer-jwt" as const },
  { owner: "other-owner" },
  { issuer: "https://other.example.net" },
  { remoteEnabled: false },
])("rechecks current policy after awaited defaults before dispatch: %j", async (loss) => {
  await setup();
  f.change({ controlEnabled: true, accessPermission: "read-control" });
  const { spawn, readDefaults } = stubStart();
  let resolve!: (value: ReturnType<typeof defaults>) => void;
  readDefaults.mockImplementation(
    () =>
      new Promise((yes) => {
        resolve = yes;
      }),
  );
  const pending = call("bb_start_thread", start);
  await expect.poll(() => readDefaults.mock.calls.length).toBe(1);
  f.change(loss);
  resolve(defaults());
  unavailable(await pending);
  expect(spawn).not.toHaveBeenCalled();
});

it.each([
  { accessAudience: "other-app" },
  { authMode: "bearer-jwt" as const },
  { owner: "other-owner" },
])("discards project content when authenticated access changes during a read: %j", async (loss) => {
  await setup();
  let resolve!: (value: Awaited<ReturnType<typeof f.list>>) => void;
  f.list.mockImplementation(
    () =>
      new Promise((yes) => {
        resolve = yes;
      }),
  );
  const pending = call("bb_list_projects", {});
  await expect.poll(() => f.list.mock.calls.length).toBe(1);
  f.change(loss);
  resolve([]);
  expect(await pending).toMatchObject({
    isError: true,
    content: [{ type: "text", text: "PROJECTS_UNAVAILABLE" }],
  });
});

it.each([
  { accessPermission: "read" as const },
  { controlEnabled: false },
  { accessAudience: "other-app" },
  { authMode: "bearer-jwt" as const },
  { owner: "other-owner" },
  { issuer: "https://other.example.net" },
])("rechecks policy after awaited membership before a cached mutation reply: %j", async (loss) => {
  await setup();
  f.change({ accessPermission: "read-control", controlEnabled: true });
  const { spawn } = stubStart();
  expect((await call("bb_start_thread", start)).structuredContent.state).toBe("accepted");
  f.host.harness.sdk.stub("threads.get", async () => {
    f.change(loss);
    return makeThreadResponse({ id: "thr_cf", projectId: "proj_a" });
  });
  unavailable(await call("bb_start_thread", start));
  expect(spawn).toHaveBeenCalledTimes(1);
});

it("keeps the issuer/owner/tool/key ledger identity across an explicit mode change", async () => {
  await setup();
  f.change({ accessPermission: "read-control", controlEnabled: true });
  const { spawn } = stubStart();
  const accepted = (await call("bb_start_thread", start)).structuredContent;
  f.change({ authMode: "bearer-jwt" });
  expect(
    (await call("bb_start_thread", start, await f.token({ scope: "bb.read bb.control" })))
      .structuredContent,
  ).toEqual(accepted);
  f.change({ authMode: "cloudflare-access" });
  expect((await call("bb_start_thread", start)).structuredContent).toEqual(accepted);
  expect(spawn).toHaveBeenCalledTimes(1);
});

it("enforces assertion expiry after an awaited default lookup", async () => {
  await setup();
  f.change({ accessPermission: "read-control", controlEnabled: true });
  const { spawn, readDefaults } = stubStart();
  readDefaults.mockImplementation(async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 900001);
    return defaults();
  });
  unavailable(await call("bb_start_thread", start));
  expect(spawn).not.toHaveBeenCalled();
});

it("rejects forwarded Host/Origin and BB routes while allowing authenticated project discovery", async () => {
  await setup();
  const token = await f.token();
  expect(
    (
      await f.rpc("tools/list", {}, token, {
        host: "bb.example.net",
        "x-forwarded-host": "mcp.example.org",
      })
    ).status,
  ).toBe(403);
  expect(
    (await f.rpc("tools/list", {}, token, { origin: "https://other.example.net" })).status,
  ).toBe(403);
  expect(
    (await f.request("/api/v1/projects", { headers: { "cf-access-jwt-assertion": token } })).status,
  ).toBe(404);
  expect((await call("bb_list_projects", {}, token)).structuredContent).toEqual({
    projects: [
      { id: "proj_a", name: "Allowed" },
      { id: "proj_hidden", name: "Private" },
    ],
    nextCursor: null,
  });
  expect(f.host.harness.inspection.sdk.calls.map((c) => c.path)).toEqual(["projects.list"]);
});

it("bounds unavailable key retrieval by the fetch abort signal", async () => {
  await setup();
  const token = await f.token();
  const fetcher = vi.fn<typeof fetch>(
    async (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("KEY_FETCH_ABORTED")), {
          once: true,
        });
      }),
  );
  await expect(
    authenticator(fetcher)({ "cf-access-jwt-assertion": token }, f.policy(), f.policy()),
  ).rejects.toThrow();
  expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
});

it("keeps uncertain Cloudflare submissions unknown and never replays them after reload", async () => {
  f = await fixture(
    {},
    { limits: { responseWaitMs: 20, sdkDeadlineMs: 80 } },
    undefined,
    "cloudflare-access",
  );
  f.change({ accessPermission: "read-control", controlEnabled: true });
  const { spawn } = stubStart();
  spawn.mockImplementation(() => new Promise(() => {}));
  const pending = (await call("bb_start_thread", start)).structuredContent;
  expect(pending.state).toBe("pending");
  await expect
    .poll(
      async () =>
        (await call("bb_get_operation", { operationId: pending.operationId })).structuredContent
          .state,
    )
    .toBe("unknown");
  await f.restart();
  expect((await call("bb_start_thread", start)).structuredContent.state).toBe("unknown");
  expect(
    f.host.harness.inspection.sdk.calls.filter((c) => c.path === "threads.spawn"),
  ).toHaveLength(0);
});
