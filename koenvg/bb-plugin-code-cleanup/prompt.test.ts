import { afterEach, describe, expect, it } from "vitest";
import {
  createFakePluginHost,
  makePluginAgentConfigurationContext,
} from "@get-bb/plugin-sdk/testing";
import plugin from "./server";
import { defaultGuidance } from "./guidance";

const hosts: Array<ReturnType<typeof createFakePluginHost>["harness"]> = [];
afterEach(async () => {
  while (hosts.length) await hosts.pop()!.lifecycle.dispose();
});
async function setup() {
  const host = createFakePluginHost({
    pluginId: "code-cleanup",
    sdk: {
      projects: {
        list: async () =>
          [
            { id: "proj_a", name: "Alpha", kind: "standard" },
            { id: "proj_b", name: "Beta", kind: "standard" },
            { id: "personal", name: "Personal", kind: "personal" },
          ] as never,
      },
    },
  });
  hosts.push(host.harness);
  await plugin(host.bb);
  return host;
}

describe("prompt Settings through public RPC and real storage", () => {
  it("saves exact Markdown and shell text while disabled, resets only text, and delivers the factory once", async () => {
    const host = await setup();
    const call = host.harness.behavior.callRpc;
    await host.harness.behavior.runCli(["enable", "--project", "proj_b"]);
    await call("setPrompt", {
      projectId: "proj_b",
      prompt: "Other project\n",
      expectedPrompt: null,
    });
    const db = host.bb.storage.database();
    const other = db.prepare("SELECT * FROM project_settings WHERE project_id = ?").get("proj_b");
    const text =
      '  # Guidance\r\n\n- `$(name)` and ${HOME} <script>literal</script>\n```sh\necho "$HOME"\n```\n\n ';
    expect(
      await call("setPrompt", { projectId: "proj_a", prompt: text, expectedPrompt: null }),
    ).toEqual({
      status: "saved",
      state: {
        projectId: "proj_a",
        enabled: false,
        enabledOverride: null,
        enableByDefault: false,
        prompt: text,
        effectivePrompt: text,
      },
    });
    expect((await host.harness.behavior.runCli(["show", "--project", "proj_a"])).stdout).toContain(
      "disabled; prompt: custom",
    );
    await host.harness.behavior.runCli(["enable", "--project", "proj_a"]);
    const context = makePluginAgentConfigurationContext({ project: { id: "proj_a" } });
    expect((await host.harness.behavior.resolveAgentConfiguration(context)).instructions).toBe(
      text,
    );
    expect(
      await call("setPrompt", { projectId: "proj_a", prompt: null, expectedPrompt: text }),
    ).toEqual({
      status: "saved",
      state: {
        projectId: "proj_a",
        enabled: true,
        enabledOverride: true,
        enableByDefault: false,
        prompt: null,
        effectivePrompt: defaultGuidance("proj_a"),
      },
    });
    expect((await host.harness.behavior.resolveAgentConfiguration(context)).instructions).toBe(
      defaultGuidance("proj_a"),
    );
    await host.harness.behavior.runCli(["disable", "--project", "proj_a"]);
    await call("setPrompt", { projectId: "proj_a", prompt: null, expectedPrompt: null });
    expect(await call("getProject", { projectId: "proj_a" })).toEqual({
      projectId: "proj_a",
      enabled: false,
      enabledOverride: false,
      enableByDefault: false,
      prompt: null,
      effectivePrompt: defaultGuidance("proj_a"),
    });
    expect(db.prepare("SELECT * FROM project_settings WHERE project_id = ?").get("proj_b")).toEqual(
      other,
    );
  });

  it("repeated reload preserves every explicit choice and exact custom source", async () => {
    let host = await setup();
    const db = host.bb.storage.database();
    db.prepare(
      "INSERT INTO project_settings (project_id, enabled, prompt, enabled_override) VALUES (?, ?, ?, ?)",
    ).run("proj_a", 1, "  Legacy\r\n\n`$literal`\n ", 1);
    db.prepare(
      "INSERT INTO project_settings (project_id, enabled, prompt, enabled_override) VALUES (?, ?, ?, ?)",
    ).run("proj_b", 0, "Disabled\n", 0);
    const rows = db.prepare("SELECT * FROM project_settings ORDER BY project_id").all();
    for (let n = 0; n < 2; n++) {
      host = await host.harness.lifecycle.reload(plugin);
      hosts.pop();
      hosts.push(host.harness);
      expect(
        host.bb.storage
          .database()
          .prepare("SELECT * FROM project_settings ORDER BY project_id")
          .all(),
      ).toEqual(rows);
    }
  });

  it("rejects invalid text, malformed requests, and invalid targets without changing rows", async () => {
    const host = await setup();
    const call = host.harness.behavior.callRpc;
    await call("setPrompt", {
      projectId: "proj_a",
      prompt: "x".repeat(4096),
      expectedPrompt: null,
    });
    const db = host.bb.storage.database();
    const before = db.prepare("SELECT * FROM project_settings").all();
    for (const prompt of ["", " \n\t\r", "x".repeat(4097)]) {
      await expect(
        call("setPrompt", { projectId: "proj_a", prompt, expectedPrompt: "x".repeat(4096) }),
      ).rejects.toThrow();
      expect(
        (
          await host.harness.behavior.runCli([
            "prompt",
            "set",
            "--project",
            "proj_a",
            "--text",
            prompt,
          ])
        ).exitCode,
      ).toBe(1);
    }
    for (const projectId of ["missing", "personal", ""])
      for (const prompt of [null, "valid"]) {
        await expect(
          call("setPrompt", { projectId, prompt, expectedPrompt: null }),
        ).rejects.toThrow();
      }
    for (const input of [
      { projectId: "proj_a" },
      { projectId: "proj_a", prompt: 1 },
      { projectId: "proj_a", prompt: "valid", enabled: true },
      null,
    ]) {
      await expect(call("setPrompt", input)).rejects.toThrow();
    }
    expect(db.prepare("SELECT * FROM project_settings").all()).toEqual(before);
  });

  it("failed Save and Reset retain exact stored source and enablement", async () => {
    const host = await setup();
    const call = host.harness.behavior.callRpc;
    await call("setPrompt", { projectId: "proj_a", prompt: "Saved\n", expectedPrompt: null });
    await call("setEnablement", { projectId: "proj_a", enabledOverride: true });
    const db = host.bb.storage.database();
    const before = db.prepare("SELECT * FROM project_settings").all();
    db.exec(
      "CREATE TRIGGER reject_prompt_write BEFORE UPDATE ON project_settings BEGIN SELECT RAISE(ABORT, 'fixture storage failure'); END",
    );
    for (const prompt of ["Draft\n", null])
      await expect(
        call("setPrompt", { projectId: "proj_a", prompt, expectedPrompt: "Saved\n" }),
      ).rejects.toThrow("fixture storage failure");
    expect(db.prepare("SELECT * FROM project_settings").all()).toEqual(before);
  });
});
