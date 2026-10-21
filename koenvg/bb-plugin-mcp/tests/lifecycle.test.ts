import { afterEach, describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { createServer } from "node:http";
import plugin from "../server.js";
import { readConfig, settingsDefinition } from "../config.js";
import { freePort, loopbackFetch } from "./fixtures.js";

let host: ReturnType<typeof createFakePluginHost>;
afterEach(async () => {
  await host?.harness.lifecycle.dispose();
});
async function status() {
  const result = await host.harness.behavior.runCli(["status", "--json"]);
  expect(result.exitCode).toBe(0);
  return JSON.parse(result.stdout ?? "{}");
}
async function stored() {
  return {
    publicOrigin: "https://unrelated.example.net",
    port: await freePort(),
    issuer: "https://login.example.net/realm",
    owner: "owner",
    remoteEnabled: true,
    controlEnabled: false,
  };
}
async function start() {
  host.harness.behavior.runService("listener");
  await expect.poll(async () => (await status()).listener).toBe("listening");
}
async function metadata(port: number, origin = "unrelated.example.net") {
  return loopbackFetch(`http://127.0.0.1:${port}/.well-known/oauth-protected-resource/mcp`, {
    headers: { host: origin },
  });
}

describe("BB settings and listener lifecycle", () => {
  it("starts disabled and reports prerequisites without claiming reachability", async () => {
    host = createFakePluginHost();
    await plugin(host.bb);
    host.harness.behavior.runService("listener");
    expect(await status()).toMatchObject({
      remoteEnabled: false,
      configuration: "invalid",
      listener: "stopped",
      publicReachability: "unverified",
      controlTools: "disabled",
    });
    expect(host.harness.inspection.sdk.calls).toEqual([]);
    const descriptors = host.harness.inspection.registrations.settingsDescriptors;
    expect(descriptors.remoteEnabled.default).toBe(false);
    expect(descriptors.controlEnabled.default).toBe(false);
  });

  it.each([
    "https://login.example.net/",
    "https://login.example.net",
    "https://login.example.net/realm/",
    "https://login.example.net/realm",
  ])("preserves the exact bearer issuer in saved settings and metadata: %s", async (issuer) => {
    const values = { ...(await stored()), issuer };
    expect(readConfig(values)?.issuer).toBe(issuer);
    host = createFakePluginHost({ settings: values });
    await plugin(host.bb);
    await start();
    expect(await status()).toMatchObject({ configuration: "valid" });
    expect((await (await metadata(values.port)).json()).authorization_servers).toEqual([issuer]);
    host = await host.harness.lifecycle.reload(plugin);
    await start();
    expect((await (await metadata(values.port)).json()).authorization_servers).toEqual([issuer]);
    expect(host.harness.inspection.sdk.calls).toEqual([]);
  });

  it.each([
    { publicOrigin: "http://public.example.net" },
    { publicOrigin: "https://public.example.net/path" },
    { publicOrigin: "https://user:password@public.example.net" },
    { publicOrigin: "https://public.example.net?token=x" },
    { port: 0 },
    { port: 38886 },
    { port: 1.5 },
    { port: 65536 },
    { owner: "" },
    { issuer: "http://login.example.net" },
    { issuer: "not-a-url" },
    { issuer: "https://user:password@login.example.net/" },
    { issuer: "https://login.example.net/?token=x" },
    { issuer: "https://login.example.net/#fragment" },
    { issuer: "https://localhost/" },
    { issuer: "https://login/" },
    { issuer: " https://login.example.net/" },
    { issuer: "https://LOGIN.example.net/" },
    { issuer: "https://login.example.net:443/" },
    { issuer: "https://login.example.net/realm/../" },
    { owner: " owner" },
  ])("invalid saved configuration prevents listener startup: %j", async (invalid) => {
    const values = { ...(await stored()), ...invalid };
    expect(readConfig(values)).toBeNull();
    host = createFakePluginHost({ settings: values });
    await plugin(host.bb);
    host.harness.behavior.runService("listener");
    expect(await status()).toMatchObject({
      configuration: "invalid",
      listener: "stopped",
      remoteEnabled: false,
    });
  });

  it("persists settings across reload and applies origin/port changes only after reload", async () => {
    const values = await stored();
    host = createFakePluginHost({ settings: values });
    await plugin(host.bb);
    await start();
    expect((await metadata(values.port)).status).toBe(200);
    const nextPort = await freePort();
    await host.harness.behavior.setSettings({
      publicOrigin: "https://another.example.com",
      port: nextPort,
      controlEnabled: true,
    });
    expect(await status()).toMatchObject({
      url: values.publicOrigin + "/mcp",
      port: values.port,
      listener: "listening",
      reloadRequired: true,
      controlTools: "enabled",
    });
    expect((await metadata(values.port)).status).toBe(200);
    await expect(metadata(nextPort, "another.example.com")).rejects.toThrow();
    let restored: unknown;
    host = await host.harness.lifecycle.reload(async (bb) => {
      restored = await bb.settings.define(settingsDefinition).get();
    });
    expect(restored).toEqual({
      ...values,
      authMode: "bearer-jwt",
      accessAudience: "",
      accessOAuthIssuer: "",
      accessPermission: "read",
      publicOrigin: "https://another.example.com",
      port: nextPort,
      controlEnabled: true,
    });
    host = await host.harness.lifecycle.reload(plugin);
    await start();
    expect(await status()).toMatchObject({
      url: "https://another.example.com/mcp",
      port: nextPort,
      reloadRequired: false,
    });
    await expect(metadata(values.port)).rejects.toThrow();
    expect((await metadata(nextPort, "another.example.com")).status).toBe(200);
    expect(host.harness.inspection.sdk.calls).toEqual([]);
  });

  it("disable releases the port, re-enable requires reload, and invalid live values fail closed", async () => {
    const values = await stored();
    host = createFakePluginHost({ settings: values });
    await plugin(host.bb);
    await start();
    await host.harness.behavior.setSettings({ remoteEnabled: false });
    await expect.poll(async () => (await status()).listener).toBe("stopped");
    await expect(metadata(values.port)).rejects.toThrow();
    await host.harness.behavior.setSettings({ remoteEnabled: true });
    expect(await status()).toMatchObject({ listener: "stopped", reloadRequired: true });
    host = await host.harness.lifecycle.reload(plugin);
    await start();
    await host.harness.behavior.setSettings({ owner: "" });
    await expect.poll(async () => (await status()).listener).toBe("stopped");
    await expect(metadata(values.port)).rejects.toThrow();
  });

  it("repeated reload/dispose keeps no old listener or BB mutation", async () => {
    const values = await stored();
    host = createFakePluginHost({ settings: values });
    await plugin(host.bb);
    for (let i = 0; i < 5; i++) {
      await start();
      expect((await metadata(values.port)).status).toBe(200);
      const previous = host;
      host = await previous.harness.lifecycle.reload(plugin);
      await expect(metadata(values.port)).rejects.toThrow();
      expect(previous.harness.inspection.sdk.calls).toEqual([]);
    }
    await start();
    await host.harness.lifecycle.dispose();
    await expect(metadata(values.port)).rejects.toThrow();
    const reuse = createServer();
    await new Promise<void>((resolve, reject) => {
      reuse.on("error", reject);
      reuse.listen(values.port, "127.0.0.1", resolve);
    });
    await new Promise<void>((resolve) => reuse.close(() => resolve()));
  });

  it("shutdown during startup releases the port", async () => {
    const values = await stored();
    host = createFakePluginHost({ settings: values });
    await plugin(host.bb);
    const service = host.harness.behavior.runService("listener");
    service.controller.abort();
    await service.done;
    await expect(metadata(values.port)).rejects.toThrow();
    const reuse = createServer();
    await new Promise<void>((resolve, reject) => {
      reuse.on("error", reject);
      reuse.listen(values.port, "127.0.0.1", resolve);
    });
    await new Promise<void>((resolve) => reuse.close(() => resolve()));
  });
});
