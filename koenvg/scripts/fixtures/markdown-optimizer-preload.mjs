import fsp from "node:fs/promises";
import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import { mock } from "bun:test";

const require = createRequire(`${process.cwd()}/package.json`);
const esbuild = require("esbuild");
const vitePath = require.resolve("vite");
const gates = {
  scan: Promise.withResolvers(),
  crawl: Promise.withResolvers(),
  writer: Promise.withResolvers(),
};
const reported = new Set();
const report = (event) => {
  if (reported.has(event)) return;
  reported.add(event);
  console.error(`OPTIMIZER ${JSON.stringify({ event })}`);
};
const commands = createInterface({ input: process.stdin });
commands.on("line", (command) => {
  gates[command]?.resolve();
  if (command === "writer") {
    commands.close();
    process.stdin.pause();
  }
});
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
  report("signal");
});

const originalContext = esbuild.context;
const instrumentedContext = async (options) => {
  const scanning = options.plugins?.some((plugin) => plugin.name === "vite:dep-scan");
  const writing = Boolean(options.outdir);
  if (writing) {
    options = {
      ...options,
      plugins: [
        ...options.plugins,
        {
          name: "markdown-optimizer-gate",
          setup(build) {
            build.onStart(async () => {
              report("writer-held");
              await gates.writer.promise;
            });
          },
        },
      ],
    };
  }
  const context = await originalContext(options);
  const rebuild = context.rebuild.bind(context);
  context.rebuild = async () => {
    const result = await rebuild();
    if (scanning) {
      report("scan-held");
      await gates.scan.promise;
      report("scan-delivered");
    }
    if (writing) report("writer-finished");
    return result;
  };
  return context;
};
mock.module(require.resolve("esbuild"), () => ({
  ...esbuild,
  context: instrumentedContext,
  default: { ...esbuild, context: instrumentedContext },
}));

const vite = await import(vitePath);
const createServer = vite.createServer;
mock.module(vitePath, () => ({
  ...vite,
  createServer: async (options) => {
    const server = await createServer({
      ...options,
      plugins: [
        ...(options.plugins ?? []),
        {
          name: "markdown-optimizer-observer",
          configureServer(server) {
            const environment = server.environments.client;
            const idle = environment.waitForRequestsIdle.bind(environment);
            environment.waitForRequestsIdle = async (...args) => {
              await idle(...args);
              report("crawl-held");
              await gates.crawl.promise;
            };
            const optimizer = environment.depsOptimizer;
            let scanProcessing;
            Object.defineProperty(optimizer, "scanProcessing", {
              get() {
                if (stopping && scanProcessing) report("shutdown-scan-read");
                return scanProcessing;
              },
              set(value) {
                scanProcessing = value;
                value?.then(() => {
                  for (const info of Object.values(optimizer.metadata.discovered)) {
                    let processing = info.processing;
                    Object.defineProperty(info, "processing", {
                      get() {
                        if (stopping) report("processing-read");
                        return processing;
                      },
                      set(value) {
                        processing = value;
                      },
                    });
                  }
                });
              },
            });
          },
        },
      ],
    });
    const close = server.close.bind(server);
    server.close = async () => {
      report("close-started");
      await close();
      report("close-finished");
    };
    return server;
  },
}));

const originalRm = fsp.rm;
const observedRm = async (path, options) => {
  const owned = /\/(?:markdown-reader|tasks)-preview-[^/]+$/.test(String(path));
  if (owned) report("cache-removing");
  await originalRm(path, options);
  if (owned) report("cache-removed");
};
mock.module("node:fs/promises", () => ({
  ...fsp,
  rm: observedRm,
  default: { ...fsp, rm: observedRm },
}));
