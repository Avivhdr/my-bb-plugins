import type { ChangedFile } from "./changes";
import { compareFilePaths } from "./file-order";

export type FileTreeRow =
  | { kind: "folder"; label: string; path: string; depth: number }
  | { kind: "file"; label: string; file: ChangedFile; depth: number };

interface Folder {
  folders: Map<string, Folder>;
  files: Map<string, ChangedFile>;
}

function emptyFolder(): Folder {
  return { folders: new Map(), files: new Map() };
}

export function buildFileTree(files: readonly ChangedFile[]): FileTreeRow[] {
  const root = emptyFolder();
  for (const file of [...files].sort((a, b) => compareFilePaths(a.path, b.path))) {
    const segments = file.path.split("/");
    const name = segments.pop()!;
    let folder = root;
    for (const segment of segments) {
      let child = folder.folders.get(segment);
      if (child === undefined) {
        child = emptyFolder();
        folder.folders.set(segment, child);
      }
      folder = child;
    }
    folder.files.set(name, file);
  }
  const rows: FileTreeRow[] = [];
  appendRows(root, "", 0, rows);
  return rows;
}

function appendRows(folder: Folder, parentPath: string, depth: number, rows: FileTreeRow[]) {
  for (const [name, first] of folder.folders) {
    let label = name;
    let child = first;
    while (child.files.size === 0 && child.folders.size === 1) {
      const [onlyChildName, onlyChild] = child.folders.entries().next().value!;
      label = `${label}/${onlyChildName}`;
      child = onlyChild;
    }
    const path = parentPath === "" ? label : `${parentPath}/${label}`;
    rows.push({ kind: "folder", label, path, depth });
    appendRows(child, path, depth + 1, rows);
  }
  for (const [name, file] of folder.files) rows.push({ kind: "file", label: name, file, depth });
}

export function visibleRows(
  rows: readonly FileTreeRow[],
  collapsed: ReadonlySet<string>,
): FileTreeRow[] {
  const visible: FileTreeRow[] = [];
  let hiddenBelow: number | null = null;
  for (const row of rows) {
    if (hiddenBelow !== null && row.depth > hiddenBelow) continue;
    hiddenBelow = row.kind === "folder" && collapsed.has(row.path) ? row.depth : null;
    visible.push(row);
  }
  return visible;
}
