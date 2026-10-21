import type { LocalCommitsAhead, LocalCommitsRequest } from "../contract";
import type { CachedPr } from "../refresh/insight-service";

interface LocalCommitsLookupDeps {
  cachedPr(threadId: string): Promise<CachedPr>;
  environmentIdOf(threadId: string): Promise<string | null>;
  environment(environmentId: string): Promise<{ hostId: string; path: string | null }>;
  countLocalCommitsAhead(hostId: string, request: LocalCommitsRequest): Promise<LocalCommitsAhead>;
  warn(message: string): void;
}

const UNKNOWN: LocalCommitsAhead = { kind: "unknown" };

export function createLocalCommitsLookup(deps: LocalCommitsLookupDeps) {
  async function localCommitsAhead(threadId: string): Promise<LocalCommitsAhead> {
    try {
      const cached = await deps.cachedPr(threadId);
      if (cached.kind !== "cached" || cached.insight.pr.isCrossRepository) return UNKNOWN;
      const environmentId = await deps.environmentIdOf(threadId);
      if (environmentId === null) return UNKNOWN;
      const { hostId, path } = await deps.environment(environmentId);
      if (path === null) return UNKNOWN;
      return await deps.countLocalCommitsAhead(hostId, {
        path,
        branch: cached.insight.pr.headRefName,
      });
    } catch (error) {
      deps.warn(`Local commit check for thread ${threadId} failed: ${String(error)}`);
      return UNKNOWN;
    }
  }

  return { localCommitsAhead };
}
