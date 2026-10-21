import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { reportPreviewReady } from "../../scripts/browser-fixture-runner.mjs";

const requested = process.env.COMPOSE_CHAT_PREVIEW_PORT ?? process.env.BB_FIXTURE_PORT ?? "0";
if (!/^\d+$/.test(requested) || Number(requested) > 65535) {
  throw new Error("Invalid COMPOSE_CHAT_PREVIEW_PORT (expected 0 through 65535)");
}
const port = Number(requested);
const root = new URL("../", import.meta.url);
const assets = new Map<string, { body: Uint8Array; type: string }>();
const server = createServer((request, response) => {
  const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  const asset = assets.get(path);
  if (!asset || !["GET", "HEAD"].includes(request.method ?? "")) {
    response.writeHead(404).end("Not found");
    return;
  }
  response.writeHead(200, {
    "Content-Type": `${asset.type}; charset=utf-8`,
    "Cache-Control": "no-store",
  });
  response.end(request.method === "HEAD" ? undefined : asset.body);
});
const cancellation = new AbortController();
const cancel = () => cancellation.abort();
process.on("SIGINT", cancel);
process.on("SIGTERM", cancel);
try {
  const bundle = await build({
    absWorkingDir: fileURLToPath(root),
    entryPoints: ["tests/effects-fixture.tsx"],
    outfile: "dist/app.js",
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "es2022",
    write: false,
  });
  cancellation.signal.throwIfAborted();
  for (const output of bundle.outputFiles) {
    const name = output.path.endsWith(".css") ? "app.css" : "app.js";
    assets.set(`/dist/${name}`, {
      body: output.contents,
      type: name.endsWith(".css") ? "text/css" : "text/javascript",
    });
  }
  for (const [name, type] of [
    ["preview.html", "text/html"],
    ["browser-checks.js", "text/javascript"],
    ["voice-fixture.js", "text/javascript"],
    ["fixture-shine.svg", "image/svg+xml"],
  ]) {
    assets.set(`/tests/${name}`, { body: await readFile(new URL(`tests/${name}`, root)), type });
    cancellation.signal.throwIfAborted();
  }
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  cancellation.signal.throwIfAborted();
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected owned loopback listener");
  const origin = new URL(`http://127.0.0.1:${address.port}`).origin;
  console.log(`Synthetic preview ready at ${origin}`);
  reportPreviewReady(origin);
  await new Promise<void>((resolve) =>
    cancellation.signal.addEventListener("abort", () => resolve(), { once: true }),
  );
} catch (error) {
  if (!cancellation.signal.aborted) throw error;
} finally {
  try {
    if (server.listening) {
      const closed = new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      server.closeAllConnections();
      await closed;
    }
  } finally {
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
  }
}
