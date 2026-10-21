export type DiffSide = "additions" | "deletions";

export interface DiffLines {
  additions: Set<number>;
  deletions: Set<number>;
  contextOldToNew: Map<number, number>;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function diffLines(patch: string): DiffLines {
  const lines: DiffLines = {
    additions: new Set(),
    deletions: new Set(),
    contextOldToNew: new Map(),
  };
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
      lines.contextOldToNew.set(oldLine, newLine);
      lines.additions.add(newLine++);
      lines.deletions.add(oldLine++);
    }
  }
  return lines;
}

export function commentAnchorLine(
  lines: DiffLines,
  side: DiffSide,
  line: number,
): { side: DiffSide; line: number } {
  const newLine = side === "deletions" ? lines.contextOldToNew.get(line) : undefined;
  return newLine === undefined ? { side, line } : { side: "additions", line: newLine };
}
