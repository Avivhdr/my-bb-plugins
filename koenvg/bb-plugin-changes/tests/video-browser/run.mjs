import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { readWorkspaceVideo } from "../../core/workspace-video";

const require = createRequire(import.meta.url);
const evidence = resolve(
  process.env.VIDEO_BROWSER_EVIDENCE ??
    join(process.env.BB_THREAD_STORAGE ?? tmpdir(), `video-browser-${Date.now()}`),
);
await mkdir(evidence, { mode: 0o700 });
const root = await mkdtemp(join(tmpdir(), "bb-video-browser-"));
let browser;
let server;
let failure;
const reads = [];
const report = { kind: "local-component-fixture", evidence, cases: [], reads, cleanup: false };
try {
  for (const [name, color, videoCodec, audioCodec] of [
    ["before.mp4", "red", "libx264", "aac"],
    ["after.webm", "blue", "libvpx-vp9", "libopus"],
    ["vp8.webm", "blue", "libvpx", "libopus"],
  ]) {
    execFileSync(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        `color=c=${color}:s=320x180:r=12`,
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=48000:cl=stereo",
        "-t",
        "2",
        "-c:v",
        videoCodec,
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        audioCodec,
        join(root, name),
      ],
      { timeout: 30_000 },
    );
  }
  const built = await Bun.build({
    entrypoints: [new URL("./fixture.tsx", import.meta.url).pathname],
    target: "browser",
    plugins: [
      {
        name: "fixture-react",
        setup(build) {
          build.onResolve({ filter: /^(react|react-dom)(\/.*)?$/ }, ({ path }) => ({
            path: require.resolve(path),
          }));
        },
      },
    ],
  });
  assert(built.success, built.logs.map(String).join("\n"));
  const bundle = await built.outputs[0].text();
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/fixture.js")
        return new Response(bundle, { headers: { "content-type": "text/javascript" } });
      if (url.pathname === "/content") {
        const side = url.searchParams.get("side");
        assert(side === "before" || side === "after");
        reads.push(side);
        const path =
          side === "before"
            ? "before.mp4"
            : url.searchParams.get("codec") === "vp8"
              ? "vp8.webm"
              : "after.webm";
        return Response.json(
          await readWorkspaceVideo(
            { root, path, revision: { kind: "working-tree" } },
            request.signal,
          ),
        );
      }
      if (url.pathname !== "/") return new Response("Not found", { status: 404 });
      return new Response(
        '<!doctype html><html><head><style>body{margin:0;background:#fafafa;color:#171717;font:13px system-ui}figure{margin:0;min-width:0}figcaption{display:flex;flex-direction:column;gap:4px;padding:8px}button{min-height:36px;cursor:pointer}video{display:block;max-width:100%}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>',
        { headers: { "content-type": "text/html" } },
      );
    },
  });
  const origin = `http://127.0.0.1:${server.port}`;
  browser = await chromium.launch();
  report.browser = browser.version();
  report.codecs = await (async () => {
    const page = await browser.newPage();
    try {
      return await page.evaluate(() =>
        Object.fromEntries(
          [
            'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',
            'video/webm; codecs="vp8, opus"',
            'video/webm; codecs="vp9, opus"',
            'video/mp4; codecs="hvc1"',
          ].map((mime) => [mime, document.createElement("video").canPlayType(mime)]),
        ),
      );
    } finally {
      await page.close();
    }
  })();
  for (const width of [960, 320])
    for (const codec of ["vp9", "vp8"]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await context.route("**/*", async (route) => {
        assert(route.request().url().startsWith(origin), "No external fixture requests");
        await route.continue();
      });
      try {
        const start = reads.length;
        await page.goto(`${origin}/?codec=${codec}`);
        await expect(page.getByRole("button", { name: "Load before video" })).toBeVisible();
        assert.equal(reads.length, start, "No eager video reads");
        await page.getByRole("button", { name: "Load before video" }).click();
        await page.getByRole("button", { name: "Load after video" }).click();
        const videos = page.locator("video");
        await expect(videos).toHaveCount(2);
        const colors = [];
        for (let index = 0; index < 2; index++) {
          const video = videos.nth(index);
          assert(
            await video.evaluate(
              (node) => node.controls && !node.autoplay && node.paused && node.preload === "none",
            ),
            "Native controls without autoplay",
          );
          await video.focus();
          await video.press("Space");
          await expect.poll(() => video.evaluate((node) => node.currentTime)).toBeGreaterThan(0);
          colors.push(
            await video.evaluate((node) => {
              const canvas = document.createElement("canvas");
              canvas.width = 1;
              canvas.height = 1;
              const context = canvas.getContext("2d");
              context.drawImage(node, 0, 0, 1, 1);
              return [...context.getImageData(0, 0, 1, 1).data];
            }),
          );
          await video.press("Space");
        }
        assert(colors[0][0] > 200 && colors[0][2] < 30, "Before revision decodes red");
        assert(colors[1][2] > 200 && colors[1][0] < 30, "After revision decodes blue");
        assert(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          "No horizontal overflow",
        );
        const boxes = await videos.evaluateAll((nodes) =>
          nodes.map((node) => ({
            width: node.getBoundingClientRect().width,
            x: node.getBoundingClientRect().x,
          })),
        );
        if (width === 960) assert(boxes[1].x > boxes[0].x, "Wide preview sides share a row");
        if (width === 320) assert.equal(boxes[0].x, boxes[1].x, "Narrow preview sides stack");
        await page.screenshot({ path: join(evidence, `${width}-${codec}.png`), fullPage: true });
        await page.getByRole("button", { name: "Unload before video" }).click();
        await expect(videos).toHaveCount(1);
        assert.deepEqual(errors, []);
        report.cases.push({ width, codec, passed: true, colors, boxes });
      } finally {
        await context.close();
      }
    }
} catch (error) {
  failure = error;
  report.error = String(error);
} finally {
  await browser?.close();
  await server?.stop(true);
  await rm(root, { recursive: true, force: true });
  report.cleanup = true;
  await Bun.write(join(evidence, "report.json"), JSON.stringify(report, null, 2));
}
if (failure) throw failure;
console.log(
  `Passed ${report.cases.length} local video playback cases. ${join(evidence, "report.json")}`,
);
