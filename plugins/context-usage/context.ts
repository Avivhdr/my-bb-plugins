export interface ContextUsage {
  percent: number;
  usedTokens: number;
  windowTokens: number;
  estimated: boolean;
  source: "grok" | "provider";
}

export interface ProviderContext {
  estimated: boolean;
  usedTokens: number;
  modelContextWindow: number;
}

/** Whole percent of a window. A count above the window is session total, not fill. */
export function windowPercent(usedTokens: number, windowTokens: number): number | null {
  if (!Number.isSafeInteger(usedTokens) || !Number.isSafeInteger(windowTokens)) return null;
  if (usedTokens < 0 || windowTokens <= 0 || usedTokens > windowTokens) return null;
  return Math.round((usedTokens / windowTokens) * 100);
}

export function usageFromProvider(usage: ProviderContext | null): ContextUsage | null {
  if (!usage) return null;
  const percent = windowPercent(usage.usedTokens, usage.modelContextWindow);
  if (percent === null) return null;
  return {
    percent,
    usedTokens: usage.usedTokens,
    windowTokens: usage.modelContextWindow,
    estimated: usage.estimated,
    source: "provider",
  };
}

function wholeCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (!Number.isSafeInteger(rounded) || rounded < 0) return null;
  return rounded;
}

/** Grok writes the live window in signals.json. `contextWindowUsage` is its own whole percent. */
export function parseGrokSignals(value: unknown): ContextUsage | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const usedTokens = wholeCount(record.contextTokensUsed);
  const windowTokens = wholeCount(record.contextWindowTokens);
  if (usedTokens === null || windowTokens === null || windowTokens <= 0) return null;
  if (usedTokens > windowTokens) return null;
  const recorded = record.contextWindowUsage;
  const percent =
    typeof recorded === "number" && Number.isInteger(recorded) && recorded >= 0 && recorded <= 100
      ? recorded
      : windowPercent(usedTokens, windowTokens);
  if (percent === null) return null;
  return { percent, usedTokens, windowTokens, estimated: false, source: "grok" };
}

export function resolveContextUsage(input: {
  providerId: string;
  grok: ContextUsage | null;
  provider: ProviderContext | null;
}): ContextUsage | null {
  if (input.providerId === "acp-grok") return input.grok;
  return usageFromProvider(input.provider);
}

export function readProviderId(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  if (typeof record.providerId === "string") return record.providerId;
  const nested = record.thread;
  if (nested && typeof nested === "object") {
    const providerId = (nested as Record<string, unknown>).providerId;
    if (typeof providerId === "string") return providerId;
  }
  return "";
}

export function formatTokenCount(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 0,
  })
    .format(value)
    .toLowerCase();
}

export function contextLabel(usage: ContextUsage): string {
  const name = usage.estimated ? "Estimated context window" : "Context window";
  return `${name}, ${usage.percent}% used. ${formatTokenCount(usage.usedTokens)} of ${formatTokenCount(usage.windowTokens)} tokens.`;
}
