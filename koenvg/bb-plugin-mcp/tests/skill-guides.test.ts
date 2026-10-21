import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const skill = readFileSync(join(packageRoot, "skills/bb-mcp/SKILL.md"), "utf8");
const fixtures: string[] = [];
const expectedReferences = [
  "README.md",
  "README.md#cloudflare-managed-oauth-mode",
  "VERIFICATION-BBP80-CORRECTION.md",
  "VERIFICATION.md",
  "README.md#tool-and-request-limits",
  "README.md#thread-starts-and-operation-status",
  "README.md#follow-up-instructions",
  "README.md#stop-requests",
  "README.md#local-diagnostics-and-resolution",
];

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

it("locates canonical guides through installed plugin metadata, not skill-relative links", () => {
  expect(skill).toContain("`bb plugin list --json`");
  expect(skill).toContain("`id` is `mcp`");
  expect(skill).toContain("`rootDir`");
  expect(skill).toContain("stop and report");
  expect(skill).not.toContain("../../");
  expect([...skill.matchAll(/`\$MCP_ROOT\/([^`]+)`/g)].map((match) => match[1])).toEqual(
    expectedReferences,
  );
});

it("resolves every guide and section with a relocated installation and separate exported skill", () => {
  const root = mkdtempSync(join(tmpdir(), "mcp-skill-guides-"));
  fixtures.push(root);
  const installedRoot = join(root, "different installation", "mcp");
  const exportedRoot = join(root, "runtime", "global-skills", "bundle", "skills", "bb-mcp");
  mkdirSync(installedRoot, { recursive: true });
  cpSync(join(packageRoot, "skills/bb-mcp"), exportedRoot, { recursive: true });
  for (const file of new Set(expectedReferences.map((reference) => reference.split("#")[0]))) {
    cpSync(join(packageRoot, file), join(installedRoot, file));
  }
  const listing = {
    plugins: [
      { id: "unrelated", rootDir: root },
      { id: "mcp", rootDir: installedRoot },
    ],
  };
  const mcpRoot = listing.plugins.find((plugin) => plugin.id === "mcp")!.rootDir;
  const exportedSkill = readFileSync(join(exportedRoot, "SKILL.md"), "utf8");
  const references = [...exportedSkill.matchAll(/`\$MCP_ROOT\/([^`]+)`/g)].map((match) => match[1]);
  expect(references).toEqual(expectedReferences);
  for (const reference of references) {
    const [file, fragment] = reference.split("#");
    const path = resolve(mcpRoot, file);
    expect(path).toBe(join(installedRoot, file));
    const guide = readFileSync(path, "utf8");
    expect(guide.length).toBeGreaterThan(0);
    if (fragment) {
      const headings = [...guide.matchAll(/^#{1,6} (.+)$/gm)].map((match) =>
        match[1]
          .toLowerCase()
          .replace(/[^\w\s-]/g, "")
          .replace(/\s+/g, "-"),
      );
      expect(headings).toContain(fragment);
    }
  }
});
