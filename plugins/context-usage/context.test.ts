import { mkdtempSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseGrokSignals,
  readProviderId,
  resolveContextUsage,
  windowPercent,
} from "./context";
import { readLatestGrokSignals } from "./grok-signals";

describe("windowPercent", () => {
  it("rounds a fill that fits the window", () => {
    expect(windowPercent(86_410, 1_000_000)).toBe(9);
    expect(windowPercent(0, 256_000)).toBe(0);
    expect(windowPercent(256_000, 256_000)).toBe(100);
  });

  it("rejects a session total that is larger than the window", () => {
    expect(windowPercent(345_625, 256_000)).toBeNull();
    expect(windowPercent(-1, 256_000)).toBeNull();
    expect(windowPercent(1, 0)).toBeNull();
  });
});

describe("parseGrokSignals", () => {
  it("keeps Grok's recorded percent", () => {
    expect(
      parseGrokSignals({
        contextWindowUsage: 19,
        contextTokensUsed: 50_589,
        contextWindowTokens: 256_000,
      }),
    ).toMatchObject({ percent: 19, usedTokens: 50_589, windowTokens: 256_000, source: "grok" });
  });

  it("rejects a file that is not a window fill", () => {
    expect(parseGrokSignals({ contextTokensUsed: 400_000, contextWindowTokens: 256_000 })).toBeNull();
    expect(parseGrokSignals(null)).toBeNull();
  });
});

describe("resolveContextUsage", () => {
  it("uses Grok's window and ignores the provider total", () => {
    const grok = parseGrokSignals({
      contextWindowUsage: 19,
      contextTokensUsed: 50_589,
      contextWindowTokens: 256_000,
    });
    expect(
      resolveContextUsage({
        providerId: "acp-grok",
        grok,
        provider: { estimated: false, usedTokens: 345_625, modelContextWindow: 256_000 },
      })?.percent,
    ).toBe(19);
  });

  it("hides a Grok thread until its session file exists", () => {
    expect(
      resolveContextUsage({
        providerId: "acp-grok",
        grok: null,
        provider: { estimated: false, usedTokens: 345_625, modelContextWindow: 256_000 },
      }),
    ).toBeNull();
  });

  it("uses the provider window for other agents", () => {
    expect(
      resolveContextUsage({
        providerId: "claude-code",
        grok: null,
        provider: { estimated: true, usedTokens: 86_410, modelContextWindow: 1_000_000 },
      }),
    ).toMatchObject({ percent: 9, estimated: true, source: "provider" });
  });
});

describe("readProviderId", () => {
  it("reads a thread or a wrapped thread", () => {
    expect(readProviderId({ providerId: "acp-grok" })).toBe("acp-grok");
    expect(readProviderId({ thread: { providerId: "claude-code" } })).toBe("claude-code");
    expect(readProviderId(null)).toBe("");
  });
});

describe("readLatestGrokSignals", () => {
  it("reads the newest session whose path contains the thread id", () => {
    const root = mkdtempSync(join(tmpdir(), "context-usage-"));
    const older = join(root, "worktrees%2Fthr_abc123-1%2Frepo", "session-old");
    const newer = join(root, "worktrees%2Fthr_abc123-1%2Frepo", "session-new");
    const other = join(root, "worktrees%2Fthr_other-1%2Frepo", "session");
    for (const dir of [older, newer, other]) mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(older, "signals.json"),
      JSON.stringify({ contextWindowUsage: 10, contextTokensUsed: 10, contextWindowTokens: 100 }),
    );
    writeFileSync(
      join(newer, "signals.json"),
      JSON.stringify({ contextWindowUsage: 40, contextTokensUsed: 40, contextWindowTokens: 100 }),
    );
    writeFileSync(
      join(other, "signals.json"),
      JSON.stringify({ contextWindowUsage: 90, contextTokensUsed: 90, contextWindowTokens: 100 }),
    );
    const oldTime = new Date("2026-01-01T00:00:00Z");
    const newTime = new Date("2026-02-01T00:00:00Z");
    utimesSync(join(older, "signals.json"), oldTime, oldTime);
    utimesSync(join(newer, "signals.json"), newTime, newTime);
    expect(readLatestGrokSignals("thr_abc123", root)?.percent).toBe(40);
    expect(readLatestGrokSignals("../thr_abc123", root)).toBeNull();
  });
});
