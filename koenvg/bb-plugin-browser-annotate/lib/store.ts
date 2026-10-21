import type Database from "better-sqlite3";
import { urlKey, type Annotation, type Rect, type Viewport } from "./annotation";

export const ANNOTATION_MIGRATIONS = [
  `CREATE TABLE annotations (
     id TEXT PRIMARY KEY,
     thread_id TEXT NOT NULL,
     url TEXT NOT NULL,
     url_key TEXT NOT NULL,
     number INTEGER NOT NULL,
     kind TEXT NOT NULL,
     comment TEXT NOT NULL,
     rect TEXT NOT NULL,
     is_fixed INTEGER NOT NULL,
     viewport TEXT NOT NULL,
     image_path TEXT NOT NULL,
     resolved_at INTEGER,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX annotations_thread_url ON annotations (thread_id, url_key);`,
];

type Row = {
  id: string;
  thread_id: string;
  url: string;
  url_key: string;
  number: number;
  kind: string;
  comment: string;
  rect: string;
  is_fixed: number;
  viewport: string;
  image_path: string;
  resolved_at: number | null;
};

export interface StoredAnnotation extends Annotation {
  imagePath: string;
  resolvedAt: number | null;
}

export interface NewAnnotation {
  id: string;
  threadId: string;
  number: number;
  url: string;
  kind: string;
  comment: string;
  rect: Rect;
  isFixed: boolean;
  viewport: Viewport;
  imagePath: string;
}

function fromRow(row: Row): StoredAnnotation {
  return {
    id: row.id,
    threadId: row.thread_id,
    url: row.url,
    urlKey: row.url_key,
    number: row.number,
    kind: row.kind,
    comment: row.comment,
    rect: JSON.parse(row.rect) as Rect,
    isFixed: row.is_fixed === 1,
    viewport: JSON.parse(row.viewport) as Viewport,
    imagePath: row.image_path,
    resolvedAt: row.resolved_at,
  };
}

export function createAnnotationStore(db: Database.Database, now: () => number = Date.now) {
  const selectColumns =
    "id, thread_id, url, url_key, number, kind, comment, rect, is_fixed, viewport, image_path, resolved_at";
  const byId = db.prepare<[string], Row>(`SELECT ${selectColumns} FROM annotations WHERE id = ?`);
  const byThread = db.prepare<[string], Row>(
    `SELECT ${selectColumns} FROM annotations WHERE thread_id = ? ORDER BY number`,
  );
  const byUrl = db.prepare<[string, string], Row>(
    `SELECT ${selectColumns} FROM annotations WHERE thread_id = ? AND url_key = ? ORDER BY number`,
  );
  const nextNumber = db.prepare<[string], { next: number }>(
    "SELECT coalesce(max(number), 0) + 1 AS next FROM annotations WHERE thread_id = ?",
  );
  const insertRow = db.prepare(
    `INSERT INTO annotations (id, thread_id, url, url_key, number, kind, comment, rect, is_fixed, viewport, image_path, created_at)
     VALUES (@id, @threadId, @url, @urlKey, @number, @kind, @comment, @rect, @isFixed, @viewport, @imagePath, @createdAt)`,
  );
  const updateComment = db.prepare<[string, string]>(
    "UPDATE annotations SET comment = ? WHERE id = ?",
  );
  const deleteRow = db.prepare<[string]>("DELETE FROM annotations WHERE id = ?");
  const markResolved = db.prepare<[number, string]>(
    "UPDATE annotations SET resolved_at = ? WHERE id = ?",
  );
  const imagePaths = db.prepare<[], { image_path: string }>("SELECT image_path FROM annotations");
  const resolvedInThread = db.prepare<[string], Row>(
    `SELECT ${selectColumns} FROM annotations WHERE thread_id = ? AND resolved_at IS NOT NULL`,
  );

  const insert = db.transaction((annotation: NewAnnotation): StoredAnnotation => {
    if (nextNumber.get(annotation.threadId)!.next !== annotation.number) {
      throw new Error("Another annotation was added at the same time. Save again.");
    }
    insertRow.run({
      ...annotation,
      urlKey: urlKey(annotation.url),
      rect: JSON.stringify(annotation.rect),
      isFixed: annotation.isFixed ? 1 : 0,
      viewport: JSON.stringify(annotation.viewport),
      createdAt: now(),
    });
    return fromRow(byId.get(annotation.id)!);
  });

  const removeMany = db.transaction((ids: readonly string[]): StoredAnnotation[] => {
    const removed: StoredAnnotation[] = [];
    for (const id of ids) {
      const row = byId.get(id);
      if (!row) continue;
      deleteRow.run(id);
      removed.push(fromRow(row));
    }
    return removed;
  });

  return {
    insert,
    get(id: string): StoredAnnotation | null {
      const row = byId.get(id);
      return row ? fromRow(row) : null;
    },
    listForThread(threadId: string): StoredAnnotation[] {
      return byThread.all(threadId).map(fromRow);
    },
    listForUrl(threadId: string, url: string): StoredAnnotation[] {
      return byUrl.all(threadId, urlKey(url)).map(fromRow);
    },
    updateComment(id: string, comment: string): boolean {
      return updateComment.run(comment, id).changes > 0;
    },
    remove(id: string): StoredAnnotation | null {
      return removeMany([id])[0] ?? null;
    },
    markResolved(id: string): void {
      markResolved.run(now(), id);
    },
    imagePaths(): Set<string> {
      return new Set(imagePaths.all().map((row) => row.image_path));
    },
    removeResolved(threadId: string): StoredAnnotation[] {
      return removeMany(resolvedInThread.all(threadId).map((row) => row.id));
    },
  };
}

export type AnnotationStore = ReturnType<typeof createAnnotationStore>;
