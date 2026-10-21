import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { readConfig, settingsDefinition } from "./config.js";
import { remoteAccess } from "./remote-access.js";
import {
  operationControl,
  operationMigration,
  operationSubmissionMigration,
  operationStopMigration,
  operationResolutionMigration,
} from "./operations.js";

import { localOperationCommand, localOperationCommands } from "./local-operations.js";

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define(settingsDefinition);
  let saved = await settings.get();
  const initial = readConfig(saved);
  const connection = { publicOrigin: saved.publicOrigin, port: saved.port };
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    operationMigration,
    operationSubmissionMigration,
    operationStopMigration,
    operationResolutionMigration,
  ]);
  const operations = operationControl({
    db,
    policy: () => readConfig(saved),
    source: {
      defaults: (args) => bb.sdk.projects.defaultExecutionOptions(args),
      listProviders: (args) => bb.sdk.providers.list(args),
      systemConfig: (args) => bb.sdk.system.config(args),
      spawn: (args) => bb.sdk.threads.spawn(args),
      get: (args) => bb.sdk.threads.get(args),
      send: (args) => bb.sdk.threads.send(args),
      stop: (args) => bb.sdk.threads.stop(args),
      queue: (args) => bb.sdk.threads.queuedMessages.list(args),
      interactions: (args) => bb.sdk.threads.interactions.list(args),
    },
  });
  operations.activate();
  const access = initial
    ? remoteAccess({
        connection,
        policy: () => readConfig(saved),
        projects: { list: () => bb.sdk.projects.list({ includePersonal: false }) },
        providers: { list: (args) => bb.sdk.providers.list(args) },
        threads: {
          list: (args) => bb.sdk.threads.list(args),
          get: (args) => bb.sdk.threads.get(args),
          output: (args) => bb.sdk.threads.output(args),
          interactions: { list: (args) => bb.sdk.threads.interactions.list(args) },
        },
        operations,
        log: (event) => bb.log.warn(JSON.stringify(event)),
      })
    : null;

  settings.onChange((next) => {
    saved = next;
    if (!readConfig(next)?.remoteEnabled) void access?.close();
  });
  bb.onDispose(async () => {
    await access?.close();
    operations.close();
  });
  bb.background.service("listener", {
    async start(signal) {
      const stop = () => {
        void access?.close();
      };
      signal.addEventListener("abort", stop, { once: true });
      try {
        if (!signal.aborted && readConfig(saved)?.remoteEnabled) await access?.start();
        if (!signal.aborted)
          await new Promise<void>((resolve) =>
            signal.addEventListener("abort", () => resolve(), { once: true }),
          );
      } finally {
        signal.removeEventListener("abort", stop);
        await access?.close();
      }
    },
  });
  bb.cli.register({
    name: "mcp",
    summary: "Show local MCP readiness. Public reachability needs an external check.",
    commands: [
      { name: "status", summary: "Show listener state", usage: "bb mcp status [--json]" },
      ...localOperationCommands,
    ],
    async run(argv) {
      if (argv[0] === "operations" || argv[0] === "resolve-operation")
        return localOperationCommand(operations, argv);
      if (
        argv[0] !== "status" ||
        argv.length > 2 ||
        (argv[1] !== undefined && argv[1] !== "--json")
      ) {
        return { exitCode: 1, stderr: "Usage: bb mcp status [--json]" };
      }
      const current = readConfig(saved);
      const status = {
        ...(access?.status() ?? {
          url: null,
          port: null,
          listener: "stopped",
          publicReachability: "unverified",
        }),
        configuration: current ? "valid" : "invalid",
        remoteEnabled: current?.remoteEnabled ?? false,
        authMode: current?.authMode ?? null,
        localAppPermission:
          current?.authMode === "cloudflare-access" ? current.accessPermission : undefined,
        controlTools:
          current?.controlEnabled &&
          (current.authMode !== "cloudflare-access" || current.accessPermission === "read-control")
            ? "enabled"
            : "disabled",
        reloadRequired:
          !access ||
          connection.publicOrigin !== saved.publicOrigin ||
          connection.port !== saved.port ||
          (current?.remoteEnabled && access.status().listener === "stopped"),
        prerequisites:
          "Existing tunnel, compatible OAuth issuer, and ChatGPT connection require operator setup.",
      };
      return {
        exitCode: 0,
        stdout: JSON.stringify(status, null, argv.includes("--json") ? undefined : 2),
      };
    },
  });
}
