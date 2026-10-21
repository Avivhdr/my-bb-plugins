import { createServer as createHttpServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import { reportPreviewReady } from "../../scripts/browser-fixture-runner.mjs";

let requested = process.env.MARKDOWN_READER_PREVIEW_PORT ?? process.env.BB_FIXTURE_PORT ?? "0";
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index++) {
  const arg = args[index];
  if (arg === "--strictPort") continue;
  if (arg === "--port") requested = args[++index];
  else if (arg.startsWith("--port=")) requested = arg.slice(7);
  else throw new Error(`Unknown preview argument: ${arg}`);
}
if (typeof requested !== "string" || !/^\d+$/.test(requested) || Number(requested) > 65535) {
  throw new Error("Invalid Markdown preview port (expected 0 through 65535)");
}
const port = Number(requested);
const http = createHttpServer();
const cancellation = new AbortController();
const cancel = () => cancellation.abort();
process.on("SIGINT", cancel);
process.on("SIGTERM", cancel);
let cache: string | undefined;
let vite: ViteDevServer | undefined;
try {
  cache = await mkdtemp(
    join(process.env.BB_FIXTURE_RUN_DIR ?? tmpdir(), "markdown-reader-preview-"),
  );
  cancellation.signal.throwIfAborted();
  vite = await createViteServer({
    root: fileURLToPath(new URL("../", import.meta.url)),
    configFile: false,
    cacheDir: cache,
    resolve: { dedupe: ["react", "react-dom"] },
    server: {
      host: "127.0.0.1",
      middlewareMode: { server: http },
      hmr: { server: http },
    },
  });
  cancellation.signal.throwIfAborted();
  http.on("request", vite.middlewares);
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(port, "127.0.0.1", resolve);
  });
  cancellation.signal.throwIfAborted();
  const address = http.address();
  if (!address || typeof address === "string") throw new Error("Expected owned loopback listener");
  const origin = new URL(`http://127.0.0.1:${address.port}`).origin;
  console.log(`Synthetic preview ready at ${origin} (${cache})`);
  reportPreviewReady(origin);
  await new Promise<void>((resolve) =>
    cancellation.signal.addEventListener("abort", () => resolve(), { once: true }),
  );
} catch (error) {
  if (!cancellation.signal.aborted) throw error;
} finally {
  try {
    const closed = http.listening
      ? new Promise<void>((resolve, reject) =>
          http.close((error) => (error ? reject(error) : resolve())),
        )
      : Promise.resolve();
    http.closeAllConnections();
    try {
      // Vite can start a writer after close snapshots its optimizer cancellation targets.
      const optimizer = vite?.environments.client.depsOptimizer;
      await Promise.allSettled([optimizer?.scanProcessing]);
      await Promise.allSettled(
        Object.values(optimizer?.metadata.discovered ?? {}).map((info) => info.processing),
      );
    } finally {
      try {
        await vite?.close();
      } finally {
        await closed;
      }
    }
  } finally {
    if (cache) await rm(cache, { recursive: true, force: true });
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
  }
}
