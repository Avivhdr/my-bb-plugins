import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { it, expect } from "vitest";
import { request } from "node:http";

it("guards isolated fixture requests and preserves split UTF-8 prompt text", async () => {
  // Split the Node flag because SDK 0.5.9's text scanner mistakes it for a JS import.
  const child = spawn(process.execPath, ["--im" + "port", "tsx", "preview/server.ts"], {
    cwd: fileURLToPath(new URL(".", import.meta.url)),
    env: { ...process.env, PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stderr.on("data", (data) => {
    output += data;
  });
  try {
    const base = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`Preview did not start: ${output}`)),
        15000,
      );
      child.once("exit", () => {
        clearTimeout(timeout);
        reject(new Error(`Preview exited: ${output}`));
      });
      child.stdout.on("data", (data) => {
        output += data;
        const match = output.match(/fixture ready at (http:\/\/127\.0\.0\.1:\d+)/);
        if (match) {
          clearTimeout(timeout);
          resolve(match[1]);
        }
      });
    });
    const withHost = (path: string, host: string, body?: string) =>
      new Promise<number>((resolve, reject) => {
        const req = request(
          base + path,
          {
            method: body ? "POST" : "GET",
            headers: { Host: host, "Content-Type": "application/json" },
          },
          (res) => {
            res.resume();
            res.once("end", () => resolve(res.statusCode!));
          },
        );
        req.once("error", reject);
        req.end(body);
      });
    for (const host of [
      "attacker.example",
      "127.0.0.1.attacker.example",
      "attacker@localhost",
      "localhost/attacker",
    ]) {
      expect(await withHost("/", host)).toBe(403);
      expect(await withHost("/app.tsx", host)).toBe(403);
      expect(
        await withHost(
          "/fixture-rpc/setEnablement",
          host,
          JSON.stringify({ projectId: "fixture_beta", enabledOverride: true }),
        ),
      ).toBe(403);
      expect(
        await withHost("/fixture-default", host, JSON.stringify({ enableByDefault: true })),
      ).toBe(403);
      expect(
        await withHost(
          "/fixture-rpc/setPrompt",
          host,
          JSON.stringify({ projectId: "fixture_beta", prompt: "Hostile write" }),
        ),
      ).toBe(403);
    }
    expect((await fetch(base + "/")).status).toBe(200);
    expect(
      (await fetch(base + "/", { headers: { Host: "localhost:" + new URL(base).port } })).status,
    ).toBe(200);
    const rpc = async (method: string, input: unknown) => {
      const response = await fetch(base + "/fixture-rpc/" + method, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      expect(response.status).toBe(200);
      return (await response.json()).result;
    };
    const splitRpc = async (method: string, input: unknown, character: string) => {
      const body = Buffer.from(JSON.stringify(input));
      const characterStart = body.indexOf(Buffer.from(character));
      expect(characterStart).toBeGreaterThanOrEqual(0);
      const splitAt = characterStart + 1;
      const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = request(
          base + "/fixture-rpc/" + method,
          { method: "POST", headers: { "Content-Type": "application/json" } },
          (res) => {
            let text = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => (text += chunk));
            res.once("error", reject);
            res.once("end", () => resolve({ status: res.statusCode!, body: text }));
          },
        );
        req.once("error", reject);
        req.write(body.subarray(0, splitAt), () => {
          // Let the server consume the leading byte before writing the rest of the character.
          setTimeout(() => req.end(body.subarray(splitAt)), 50);
        });
      });
      expect(response.status).toBe(200);
      return JSON.parse(response.body).result;
    };
    const events = await (await fetch(base + "/fixture-events")).json();
    expect(events.signals).toHaveLength(5);
    const before = await rpc("getProject", { projectId: "fixture_beta" });
    expect(before.enabled).toBe(false);
    expect(
      await rpc("setEnablement", { projectId: "fixture_beta", enabledOverride: true }),
    ).toEqual({ ...before, enabled: true, enabledOverride: true });
    expect(await rpc("getProject", { projectId: "fixture_beta" })).toEqual({
      ...before,
      enabled: true,
      enabledOverride: true,
    });
    const exact = "# Fixture\n\n`$literal`\n";
    expect(
      await rpc("setPrompt", { projectId: "fixture_beta", prompt: exact, expectedPrompt: null }),
    ).toEqual({
      status: "saved",
      state: {
        ...before,
        enabled: true,
        enabledOverride: true,
        prompt: exact,
        effectivePrompt: exact,
      },
    });
    expect(
      await rpc("setPrompt", { projectId: "fixture_beta", prompt: null, expectedPrompt: exact }),
    ).toEqual({
      status: "saved",
      state: {
        ...before,
        enabled: true,
        enabledOverride: true,
      },
    });
    const updates = await (await fetch(base + `/fixture-events?since=${events.cursor}`)).json();
    expect(updates.signals.map((s: { payload: unknown }) => s.payload)).toEqual(
      Array(3).fill({ kind: "project", projectId: "fixture_beta" }),
    );
    expect(
      (await (await fetch(base + `/fixture-events?since=${updates.cursor}`)).json()).signals,
    ).toEqual([]);
    expect((await fetch(base + "/fixture-events?since=-1")).status).toBe(400);
    const defaults = await fetch(base + "/fixture-default");
    expect(defaults.status).toBe(200);
    expect(await defaults.json()).toMatchObject({
      value: false,
      descriptor: {
        type: "boolean",
        default: false,
        label: "Enable for projects without an override",
      },
    });
    const defaultWrite = await fetch(base + "/fixture-default", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enableByDefault: true }),
    });
    expect(defaultWrite.status).toBe(200);
    expect(await defaultWrite.json()).toMatchObject({
      value: true,
      signals: [{ channel: "settings.changed", payload: { kind: "default" } }],
    });
    expect(
      await rpc("setEnablement", { projectId: "fixture_beta", enabledOverride: null }),
    ).toEqual({ ...before, enabled: true, enabledOverride: null, enableByDefault: true });
    const unicodePrompt = "  # Split 💡 é 漢 text\n\n`$literal`\n";
    for (const character of ["💡", "é", "漢"]) {
      expect(
        await splitRpc(
          "setPrompt",
          { projectId: "fixture_beta", prompt: unicodePrompt, expectedPrompt: null },
          character,
        ),
      ).toMatchObject({ status: "saved", state: { prompt: unicodePrompt } });
      expect(await rpc("getProject", { projectId: "fixture_beta" })).toMatchObject({
        prompt: unicodePrompt,
        effectivePrompt: unicodePrompt,
      });
      expect(
        await splitRpc(
          "setPrompt",
          { projectId: "fixture_beta", prompt: null, expectedPrompt: unicodePrompt },
          character,
        ),
      ).toMatchObject({ status: "saved", state: { prompt: null } });
    }
    // Both saved and submitted prompts must fit, including JSON escape expansion.
    let expectedPrompt: string | null = null;
    for (const prompt of ["x".repeat(4096), "\u0001".repeat(4096), "\u0002".repeat(4096)]) {
      expect(
        await rpc("setPrompt", { projectId: "fixture_beta", prompt, expectedPrompt }),
      ).toMatchObject({
        status: "saved",
        state: { prompt },
      });
      expectedPrompt = prompt;
    }
    for (const [path, body] of [
      ["/fixture-rpc/setPrompt", "x".repeat(65537)],
      ["/fixture-rpc/setPrompt", "💡".repeat(16385)],
      ["/fixture-default", "x".repeat(1025)],
      ["/fixture-default", "é".repeat(513)],
    ]) {
      const oversized = await fetch(base + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      expect(oversized.status).toBe(400);
      expect(await oversized.json()).toMatchObject({ error: "Request too large" });
    }
    expect(await rpc("getProject", { projectId: "fixture_beta" })).toMatchObject({
      prompt: expectedPrompt,
    });
    expect(await (await fetch(base + "/fixture-default")).json()).toMatchObject({ value: true });
  } finally {
    if (child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
  }
}, 25000);
