import { expect, it, vi } from "vitest";
import { fixture } from "./fixtures.js";

it("starts an authenticated fixture without per-test RSA key generation", async () => {
  const generate = vi
    .spyOn(crypto.subtle, "generateKey")
    .mockRejectedValue(new Error("Key generation unavailable"));
  let f: Awaited<ReturnType<typeof fixture>> | undefined;
  try {
    f = await fixture();
    const reply = await f.rpc("tools/call", { name: "bb_list_projects", arguments: {} });
    expect(reply.status).toBe(200);
    expect((await reply.json()).result.structuredContent.projects).toEqual([
      { id: "proj_a", name: "Allowed" },
      { id: "proj_hidden", name: "Private" },
    ]);
    expect(generate).not.toHaveBeenCalled();
  } finally {
    generate.mockRestore();
    await f?.close();
  }
});

it("holds distinct OS-assigned listener ports for concurrent fixtures", async () => {
  const fixtures = await Promise.all(Array.from({ length: 8 }, () => fixture()));
  try {
    const ports = fixtures.map((f) => f.policy().port);
    expect(new Set(ports).size).toBe(fixtures.length);
    for (const f of fixtures) {
      expect(f.access.status()).toMatchObject({ port: f.policy().port, listener: "listening" });
      expect(f.policy().port).toBeGreaterThanOrEqual(1024);
      expect(f.local).toBe(`http://127.0.0.1:${f.policy().port}`);
      expect((await f.request("/.well-known/oauth-protected-resource/mcp")).status).toBe(200);
      expect(f.host.harness.inspection.sdk.calls).toEqual([]);
    }
  } finally {
    await Promise.all(fixtures.map((f) => f.close()));
  }
});

it("keeps issuer key changes local to each fixture", async () => {
  const [changed, unchanged] = await Promise.all([fixture(), fixture()]);
  try {
    changed.issuerKeys.keys[0].kid = "rotated";
    const request = { name: "bb_list_projects", arguments: {} };
    expect((await changed.rpc("tools/call", request)).status).toBe(401);
    const reply = await unchanged.rpc("tools/call", request);
    expect(reply.status).toBe(200);
    expect((await reply.json()).result.structuredContent.projects).toEqual([
      { id: "proj_a", name: "Allowed" },
      { id: "proj_hidden", name: "Private" },
    ]);
  } finally {
    await Promise.all([changed.close(), unchanged.close()]);
  }
});

it("retains the fixture connection port across restart", async () => {
  const f = await fixture();
  try {
    const port = f.policy().port;
    await f.restart();
    expect(f.policy().port).toBe(port);
    expect(f.access.status()).toMatchObject({ port, listener: "listening" });
    expect((await f.request("/.well-known/oauth-protected-resource/mcp")).status).toBe(200);
    expect(f.host.harness.inspection.sdk.calls).toEqual([]);
  } finally {
    await f.close();
  }
});
