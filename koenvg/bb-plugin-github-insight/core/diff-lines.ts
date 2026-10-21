import type { ReviewFile } from "./pr-files";

export interface DiffLines {
  additions: Set<number>;
  deletions: Set<number>;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function diffLines(patch: string): DiffLines {
  const lines: DiffLines = { additions: new Set(), deletions: new Set() };
  let oldLine = 0;
  let newLine = 0;
  for (const text of patch.split("\n")) {
    const header = HUNK_HEADER.exec(text);
    if (header !== null) {
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
    } else if (text.startsWith("+")) {
      lines.additions.add(newLine++);
    } else if (text.startsWith("-")) {
      lines.deletions.add(oldLine++);
    } else if (text.startsWith(" ")) {
      lines.additions.add(newLine++);
      lines.deletions.add(oldLine++);
    }
  }
  return lines;
}

export type DiffSide = "LEFT" | "RIGHT";

export interface Anchor {
  path: string;
  side: DiffSide;
  line: number;
  startLine: number | null;
}

export type AnchorCheck = { ok: true } | { ok: false; reason: string };

export function checkAnchor(
  files: ReviewFile[],
  { path, side, line, startLine }: Anchor,
): AnchorCheck {
  const file = files.find((candidate) => candidate.path === path);
  if (file === undefined) return { ok: false, reason: `Not a file of this pull request: ${path}` };
  if (file.patch === null) return { ok: false, reason: `No diff available for ${path}` };
  if (startLine !== null && startLine > line) {
    return { ok: false, reason: `Start line ${startLine} is after line ${line}` };
  }
  const lines = diffLines(file.patch);
  const sideLines = side === "RIGHT" ? lines.additions : lines.deletions;
  const first = startLine ?? line;
  for (let candidate = first; candidate <= line; candidate++) {
    if (sideLines.has(candidate)) continue;
    const subject = first === line ? `Line ${line} is not` : `Lines ${first}-${line} are not all`;
    return {
      ok: false,
      reason: `${subject} in the diff of ${path} on the ${side} side. Diff ranges: ${rangesText(sideLines)}`,
    };
  }
  return { ok: true };
}

function rangesText(lines: Set<number>): string {
  const sorted = [...lines].sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = sorted[0];
  for (let index = 0; index < sorted.length; index++) {
    const current = sorted[index]!;
    if (sorted[index + 1] === current + 1) continue;
    ranges.push(start === current ? `${current}` : `${start}-${current}`);
    start = sorted[index + 1];
  }
  return ranges.length === 0 ? "none" : ranges.join(", ");
}
