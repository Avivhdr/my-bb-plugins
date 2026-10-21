export type LineRequest =
  | Readonly<{ startLineNumber: number; endLineNumber: number }>
  | null
  | undefined;
export interface LineTarget {
  start: number;
  end: number;
}
export interface SourceLines {
  readonly text: string;
  readonly lines: readonly string[];
  target(request: unknown): LineTarget | null;
}

export function createSourceLines(text: string): SourceLines {
  let indexed: readonly string[] | undefined;
  function lines(): readonly string[] {
    if (indexed) return indexed;
    const result: string[] = [];
    const pattern = /([^\r\n]*)(\r\n|\r|\n|$)/g;
    for (;;) {
      const match = pattern.exec(text)!;
      result.push(match[0]);
      if (!match[2]) break;
    }
    indexed = Object.freeze(result);
    return indexed;
  }
  return Object.freeze({
    text,
    get lines() {
      return lines();
    },
    target(request: unknown) {
      if (!text || !request || typeof request !== "object") return null;
      const { startLineNumber: start, endLineNumber: end } = request as Record<string, unknown>;
      if (
        typeof start !== "number" ||
        typeof end !== "number" ||
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end)
      )
        return null;
      const count = lines().length;
      const clamp = (line: number) => Math.max(1, Math.min(count, line));
      return { start: clamp(Math.min(start, end)), end: clamp(Math.max(start, end)) };
    },
  });
}
