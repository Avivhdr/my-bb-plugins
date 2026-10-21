// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createFakePluginHost, experimental_scanPublicSdkOnly } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";

const disposers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
});

function isPluginSourceFile(file: string) {
  return !/^(?:playwright-report|test-results)[\\/]/.test(file);
}

describe("public SDK import audit scope", () => {
  it("excludes generated browser output without hiding source violations or private dependencies", () => {
    const root = mkdtempSync(join(tmpdir(), "markdown-reader-import-audit-"));
    try {
      writeFileSync(
        join(root, "package.json"),
        JSON.stringify({ dependencies: { "@bb/private": "1.0.0" } }),
      );
      const files = [
        "playwright-report/trace/assets/view.js",
        "test-results/trace/view.js",
        "app.tsx",
        "host.ts",
        "server.ts",
        "tests/fixture.ts",
        "src/playwright-report/keep.ts",
        "src/test-results/keep.ts",
        "playwright-report-source/keep.ts",
        "test-results-source/keep.ts",
        "playwright-report.ts",
        "test-results.ts",
      ];
      for (const file of files) {
        const path = join(root, file);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(
          path,
          'import "@bb/private"; import "../../../../outside.ts"; import(moduleName);',
        );
      }
      const result = experimental_scanPublicSdkOnly(root);
      const violations = result.violations.filter((entry) => isPluginSourceFile(entry.file));
      expect(violations).toHaveLength(30);
      for (const file of files.slice(2)) {
        expect(violations.filter((entry) => entry.file === file)).toEqual([
          { file, specifier: "@bb/private", reason: "private-package" },
          { file, specifier: "../../../../outside.ts", reason: "outside-package" },
          { file, specifier: "moduleName", reason: "dynamic-specifier" },
        ]);
      }
      expect(result.privateDependencies).toEqual(["@bb/private"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("public server RPC", () => {
  it("validates the live target and routes only a confined read to the selected host", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "markdown-reader",
      sdk: {
        environments: {
          get: async () => ({
            id: "env",
            projectId: "project",
            hostId: "remote",
            path: "/work",
            status: "ready",
          }),
        },
        files: {
          read: async () => ({
            content: "# Remote",
            sha256: "hash",
            contentEncoding: "utf8",
            sizeBytes: 8,
          }),
        },
      },
    });
    disposers.push(() => harness.lifecycle.dispose());
    plugin(bb);
    const target = {
      path: "note.md",
      source: {
        kind: "workspace",
        threadId: null,
        environmentId: "env",
        projectId: "project",
        experimental_hostId: "remote",
      },
    };
    const result = await harness.behavior.callRpc("read_document", target);
    expect(result).toMatchObject({
      kind: "ready",
      snapshot: { text: "# Remote", hostId: "remote", rootPath: "/work", target },
    });
    expect(harness.inspection.sdk.callsTo("files.read")).toEqual([
      [{ hostId: "remote", rootPath: "/work", path: "/work/note.md" }],
    ]);
    expect(harness.inspection.sdk.callsTo("files.write")).toEqual([]);
    await expect(
      harness.behavior.callRpc("read_document", { ...target, rootPath: "/arbitrary" }),
    ).rejects.toThrow();
    await expect(
      harness.behavior.callRpc("read_document", { path: "note.md", source: { kind: "workspace" } }),
    ).rejects.toThrow();
    expect(harness.inspection.sdk.callsTo("files.read")).toHaveLength(1);
  });
  it.each(["host", "thread-storage"] as const)(
    "routes the narrow %s RPC through read-only SDK methods",
    async (kind) => {
      const { bb, harness } = createFakePluginHost({
        pluginId: "markdown-reader",
        experimental_callHostRpc: async ({ input }) => input,
        sdk: {
          threads: {
            get: async () => ({ id: "thread", projectId: "project", environmentId: "env" }),
            storageLocation: async () => ({
              hostId: "remote",
              storageRootPath: "/data/storage/actual-thread",
            }),
          },
          environments: {
            get: async () => ({
              id: "env",
              projectId: "project",
              hostId: "remote",
              path: "/unused-workspace",
              status: "ready",
            }),
          },
          files: {
            read: async () => ({
              content: "# Remote",
              sha256: "hash",
              contentEncoding: "utf8",
              sizeBytes: 8,
            }),
          },
        },
      });
      disposers.push(() => harness.lifecycle.dispose());
      plugin(bb);
      const path = kind === "host" ? "/notes/note.md" : "note.md";
      const target = {
        path,
        source: { kind, threadId: "thread", environmentId: null, projectId: null },
      };
      expect(await harness.behavior.callRpc("read_document", target)).toMatchObject({
        kind: "ready",
        snapshot: { target, hostId: "remote" },
      });
      const rootPath = kind === "host" ? "/notes" : "/data/storage/actual-thread";
      expect(harness.inspection.sdk.callsTo("files.read")).toEqual([
        [{ hostId: "remote", rootPath, path: kind === "host" ? path : `${rootPath}/${path}` }],
      ]);
      if (kind === "thread-storage")
        expect(harness.inspection.sdk.callsTo("threads.storageLocation")).toEqual([
          [{ threadId: "thread" }],
        ]);
      // No file-write, mutation, preview, system-host fallback, or arbitrary root transport.
      expect(
        harness.inspection.sdk.calls.every((call) =>
          ["threads.get", "threads.storageLocation", "environments.get", "files.read"].includes(
            call.path,
          ),
        ),
      ).toBe(true);
      for (const input of [
        { ...target, hostId: "server" },
        { ...target, path: "note.txt" },
        { ...target, source: { ...target.source, rootPath: "/" } },
        { ...target, source: { ...target.source, environmentId: "wrong" } },
      ]) {
        try {
          await harness.behavior.callRpc("read_document", input);
        } catch {
          /* Schema rejection is expected. */
        }
      }
      expect(harness.inspection.sdk.callsTo("files.read")).toHaveLength(1);
    },
  );
  it("imports only public SDK contracts and package-local modules", () => {
    const result = experimental_scanPublicSdkOnly(new URL("..", import.meta.url).pathname, {
      allow: [
        /^react$/,
        /^react-dom\/client$/,
        /^react-markdown$/,
        /^remark-gfm$/,
        /^remark-frontmatter$/,
        /^github-slugger$/,
        /^unist-util-visit$/,
        /^hast$/,
        /^@radix-ui\/react-slot$/,
        /^class-variance-authority$/,
        /^clsx$/,
        /^tailwind-merge$/,
        /^@bb-plugins\/markdown-document(?:\/style\.css)?$/,
        // Public frontend test runtime, used only by the browser fixture entry.
        /^@get-bb\/plugin-sdk\/testing\/app$/,
        /^@get-bb\/plugin-sdk\/testing\/host$/,
        /^@testing-library\/(react|user-event)$/,
        /^vitest\/config$/,
        /^@playwright\/test$/,
      ],
    });
    expect(
      result.violations.filter((entry) => {
        if (!isPluginSourceFile(entry.file)) return false;
        if (
          entry.reason === "outside-package" &&
          entry.file === "tests/browser/shared-parity.spec.ts" &&
          entry.specifier === "../../../packages/markdown-document/test/parity"
        )
          return false;
        if (
          entry.reason === "outside-package" &&
          entry.file === "tests/presentation-preview.tsx" &&
          /^\.\.\/\.\.\/packages\/markdown-document\/test\/fixtures\/parity(?:-report\.md\?raw|\.css)$/.test(
            entry.specifier,
          )
        )
          return false;
        if (
          entry.reason === "outside-package" &&
          ((entry.file === "playwright.config.ts" &&
            entry.specifier === "../scripts/browser-fixture-runner.mjs") ||
            (entry.file === "tests/preview-server.ts" &&
              entry.specifier === "../../scripts/browser-fixture-runner.mjs"))
        )
          return false;
        return !(
          entry.reason === "outside-allowlist" &&
          entry.file === "tests/preview-server.ts" &&
          entry.specifier === "vite"
        );
      }),
    ).toEqual([]);
    expect(result.privateDependencies).toEqual([]);
  });
});
