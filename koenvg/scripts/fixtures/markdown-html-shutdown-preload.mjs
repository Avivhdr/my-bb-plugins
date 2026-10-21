import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import { mock } from "bun:test";

const require = createRequire(
  new URL("../../bb-plugin-markdown-reader/package.json", import.meta.url),
);
const reported = new Set();
const report = (event) => {
  if (reported.has(event)) return;
  reported.add(event);
  console.error(`HTML_SHUTDOWN ${event}`);
};
const writer = Promise.withResolvers();
const commands = createInterface({ input: process.stdin });
commands.on("line", (command) => {
  if (command !== "writer") return;
  writer.resolve();
  report("writer-released");
  commands.close();
  process.stdin.pause();
});
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    report("signal");
  });
}

const esbuild = require("esbuild");
const context = esbuild.context;
const instrumentedContext = async (options) => {
  if (options.outdir) {
    options = {
      ...options,
      plugins: [
        ...options.plugins,
        {
          name: "markdown-html-writer-gate",
          setup(build) {
            build.onStart(async () => {
              report("writer-held");
              await writer.promise;
            });
          },
        },
      ],
    };
  }
  const instance = await context(options);
  if (options.outdir) {
    const rebuild = instance.rebuild.bind(instance);
    instance.rebuild = async () => {
      try {
        return await rebuild();
      } finally {
        report("writer-settled");
      }
    };
  }
  return instance;
};
mock.module(require.resolve("esbuild"), () => ({
  ...esbuild,
  context: instrumentedContext,
  default: { ...esbuild, context: instrumentedContext },
}));

const vitePath = require.resolve("vite");
const vite = await import(vitePath);
const createServer = vite.createServer;
mock.module(vitePath, () => ({
  ...vite,
  createServer: (options) =>
    createServer({
      ...options,
      plugins: [
        ...(options.plugins ?? []),
        {
          name: "markdown-html-shutdown-observer",
          configureServer(server) {
            const optimizer = server.environments.client.depsOptimizer;
            const plugin = server.config.plugins.find(
              (plugin) => plugin.name === "vite:optimized-deps",
            );
            const load = plugin.load;
            let loading = false;
            plugin.load = function (...args) {
              loading = true;
              try {
                return load.apply(this, args);
              } finally {
                loading = false;
              }
            };
            let scan;
            Object.defineProperty(optimizer, "scanProcessing", {
              get: () => scan,
              set(value) {
                scan = value;
                value?.then(() => {
                  report("scan-settled");
                  for (const info of Object.values(optimizer.metadata.discovered)) {
                    let processing = info.processing;
                    Object.defineProperty(info, "processing", {
                      get() {
                        if (loading && processing) report("optimized-load-pending");
                        if (stopping) report("shutdown-processing-read");
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
            const close = optimizer.close.bind(optimizer);
            optimizer.close = async () => {
              report("optimizer-close");
              await close();
              report("optimizer-closed");
            };
          },
        },
      ],
    }),
}));
