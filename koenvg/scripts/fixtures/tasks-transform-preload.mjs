import fs from "node:fs";
import fsp from "node:fs/promises";
import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import { mock } from "bun:test";

const require = createRequire(`${process.cwd()}/package.json`);
const release = Promise.withResolvers();
const report = (event) => console.error(`TRANSFORM ${JSON.stringify({ event })}`);
const commands = createInterface({ input: process.stdin });
commands.on("line", (command) => {
  if (command !== "release") return;
  release.resolve();
  commands.close();
  process.stdin.pause();
});
const readFile = fsp.readFile;
const observedRead = async (path, ...args) => {
  const contents = await readFile(path, ...args);
  if (/\/tasks-watch-contract-[^/]+\/tsconfig\.json$/.test(String(path))) {
    report("tsconfig-held");
    await release.promise;
    report("tsconfig-released");
  }
  return contents;
};
const promises = { ...fsp, readFile: observedRead };
mock.module("node:fs/promises", () => ({ ...promises, default: promises }));
mock.module("node:fs", () => ({ ...fs, promises, default: { ...fs, promises } }));

const vitePath = require.resolve("vite");
const vite = await import(vitePath);
const createServer = vite.createServer;
mock.module(vitePath, () => ({
  ...vite,
  createServer: async (...args) => {
    const server = await createServer(...args);
    let watcherClosing = false;
    const add = server.watcher.add.bind(server.watcher);
    server.watcher.add = (...paths) => {
      if (watcherClosing) report("late-watch-add");
      return add(...paths);
    };
    const closeWatcher = server.watcher.close.bind(server.watcher);
    server.watcher.close = async () => {
      watcherClosing = true;
      report("watcher-close-started");
      await closeWatcher();
      report("watcher-close-finished");
    };
    const client = server.environments.client;
    void (async () => {
      const optimizer = client.depsOptimizer;
      await optimizer.scanProcessing;
      await Promise.allSettled(
        Object.values(optimizer.metadata.discovered).map((info) => info.processing),
      );
      report("optimizer-ready");
    })();
    const closeEnvironment = client.close.bind(client);
    client.close = async () => {
      report("environment-close-started");
      await closeEnvironment();
      report("environment-close-finished");
    };
    return server;
  },
}));
