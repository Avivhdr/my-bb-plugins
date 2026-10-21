import { afterEach, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { readConfig, settingsDefinition } from "../config.js";
import plugin from "../server.js";
import { freePort, loopbackFetch } from "./fixtures.js";

let host: ReturnType<typeof createFakePluginHost>;
afterEach(async () => {
  await host?.harness.lifecycle.dispose();
});
async function values() {
  return {
    publicOrigin: "https://mcp.example.net",
    port: await freePort(),
    issuer: "https://access.example.net",
    owner: "verified-owner",
    remoteEnabled: true,
    controlEnabled: false,
    authMode: "cloudflare-access",
    accessAudience: "dedicated-aud",
    accessOAuthIssuer: "https://oauth.example.net/",
  };
}
async function status() {
  return JSON.parse((await host.harness.behavior.runCli(["status", "--json"])).stdout ?? "{}");
}
it("defaults legacy installations to bearer and all new Cloudflare permissions to read", async () => {
  const config = await values();
  expect(readConfig(config)?.accessPermission).toBe("read");
  const { authMode: _mode, accessAudience: _aud, accessOAuthIssuer: _oauth, ...legacy } = config;
  expect(readConfig(legacy)?.authMode).toBe("bearer-jwt");
  expect(settingsDefinition.authMode.default).toBe("bearer-jwt");
  expect(settingsDefinition.accessPermission.default).toBe("read");
  expect(settingsDefinition.remoteEnabled.default).toBe(false);
  expect(settingsDefinition.controlEnabled.default).toBe(false);
});
const invalidConfigurations: Record<string, string>[] = [
  { accessAudience: "" },
  { accessAudience: "aud,another" },
  { accessAudience: " aud " },
  { accessOAuthIssuer: "" },
  { accessOAuthIssuer: "http://oauth.example.net" },
  { accessOAuthIssuer: "https://user:secret@oauth.example.net" },
  { accessOAuthIssuer: "https://oauth.example.net?token=secret" },
  { accessOAuthIssuer: "https://oauth.example.net#fragment" },
  { accessOAuthIssuer: "https://localhost" },
  { issuer: "https://access.example.net/realm" },
  { issuer: "https://access.example.net/" },
  { accessPermission: "bb.control" },
  { authMode: "auto" },
  { owner: "" },
];
it.each(invalidConfigurations)(
  "incomplete/invalid Cloudflare config fails closed without SDK reads: %j",
  async (invalid) => {
    const config = { ...(await values()), ...invalid };
    expect(readConfig(config)).toBeNull();
    host = createFakePluginHost({ settings: config });
    await plugin(host.bb);
    host.harness.behavior.runService("listener");
    expect(await status()).toMatchObject({
      listener: "stopped",
      configuration: "invalid",
      remoteEnabled: false,
      controlTools: "disabled",
    });
    expect(host.harness.inspection.sdk.calls).toEqual([]);
  },
);
it("persists explicit mode/permission, reports both control gates and closes on live AUD removal", async () => {
  const config = { ...(await values()), controlEnabled: true };
  host = createFakePluginHost({ settings: config });
  await plugin(host.bb);
  host.harness.behavior.runService("listener");
  await expect.poll(async () => (await status()).listener).toBe("listening");
  expect(await status()).toMatchObject({
    authMode: "cloudflare-access",
    localAppPermission: "read",
    controlTools: "disabled",
  });
  const metadata = await loopbackFetch(
    `http://127.0.0.1:${config.port}/.well-known/oauth-protected-resource/mcp`,
    { headers: { host: "mcp.example.net" } },
  );
  expect((await metadata.json()).authorization_servers).toEqual([config.accessOAuthIssuer]);
  await host.harness.behavior.setSettings({ accessPermission: "read-control" });
  expect((await status()).controlTools).toBe("enabled");
  host = await host.harness.lifecycle.reload(plugin);
  expect(await status()).toMatchObject({
    authMode: "cloudflare-access",
    localAppPermission: "read-control",
    controlTools: "enabled",
    configuration: "valid",
  });
  host.harness.behavior.runService("listener");
  await expect.poll(async () => (await status()).listener).toBe("listening");
  await host.harness.behavior.setSettings({ accessAudience: "" });
  await expect.poll(async () => (await status()).listener).toBe("stopped");
  expect((await status()).configuration).toBe("invalid");
  await expect(
    loopbackFetch(`http://127.0.0.1:${config.port}/mcp`, { headers: { host: "mcp.example.net" } }),
  ).rejects.toThrow();
  expect(host.harness.inspection.sdk.calls).toEqual([]);
});
