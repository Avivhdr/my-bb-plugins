import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseGrokSignals, type ContextUsage } from "./context";

const THREAD_ID = /^thr_[a-z0-9]+$/;

export function grokSessionsRoot(): string {
  const home = process.env.GROK_HOME;
  if (home && home.startsWith("/")) return join(home, "sessions");
  return join(homedir(), ".grok", "sessions");
}

function readSignalsFile(file: string): { usage: ContextUsage; mtimeMs: number } | null {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(file).mtimeMs;
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
  } catch {
    return null;
  }
  const usage = parseGrokSignals(parsed);
  if (!usage) return null;
  return { usage, mtimeMs };
}

/** The newest Grok session whose directory name contains this BB thread id. */
export function readLatestGrokSignals(threadId: string, root: string): ContextUsage | null {
  if (!THREAD_ID.test(threadId)) return null;
  let cwdDirs: string[];
  try {
    cwdDirs = readdirSync(root);
  } catch {
    return null;
  }
  let best: { usage: ContextUsage; mtimeMs: number } | null = null;
  for (const cwdDir of cwdDirs) {
    if (!cwdDir.includes(threadId)) continue;
    let sessions: string[];
    try {
      sessions = readdirSync(join(root, cwdDir));
    } catch {
      continue;
    }
    for (const session of sessions) {
      if (session.startsWith(".")) continue;
      const found = readSignalsFile(join(root, cwdDir, session, "signals.json"));
      if (!found) continue;
      if (!best || found.mtimeMs >= best.mtimeMs) best = found;
    }
  }
  return best?.usage ?? null;
}
