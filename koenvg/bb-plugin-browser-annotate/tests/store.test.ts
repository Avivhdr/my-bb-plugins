// @vitest-environment node
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { urlKey } from "../lib/annotation";
import { ANNOTATION_MIGRATIONS, createAnnotationStore, type NewAnnotation } from "../lib/store";

function setup() {
  const db = new Database(":memory:");
  for (const statement of ANNOTATION_MIGRATIONS) db.exec(statement);
  return createAnnotationStore(db, () => 1000);
}

function annotation(
  id: string,
  number: number,
  overrides: Partial<NewAnnotation> = {},
): NewAnnotation {
  return {
    id,
    number,
    threadId: "thr",
    url: "https://example.com/a",
    kind: "button",
    comment: "Too much padding",
    rect: { x: 10, y: 20, width: 100, height: 40 },
    isFixed: false,
    viewport: { width: 1440, height: 900 },
    imagePath: `/data/${id}.jpg`,
    ...overrides,
  };
}

describe("annotation store", () => {
  it("accepts only the next number of the thread", () => {
    const store = setup();

    expect(store.insert(annotation("a", 1)).number).toBe(1);
    expect(() => store.insert(annotation("b", 1))).toThrow("Save again");
    expect(store.insert(annotation("b", 2)).number).toBe(2);
    expect(store.insert(annotation("c", 1, { threadId: "other" })).number).toBe(1);
  });

  it("keeps numbers unique after deleting a middle annotation", () => {
    const store = setup();
    store.insert(annotation("a", 1));
    store.insert(annotation("b", 2));
    store.insert(annotation("c", 3));

    store.remove("b");

    expect(() => store.insert(annotation("d", 3))).toThrow();
    expect(store.insert(annotation("d", 4)).number).toBe(4);
  });

  it("starts at 1 again after a full clear", () => {
    const store = setup();
    store.insert(annotation("a", 1));
    store.insert(annotation("b", 2));
    store.markResolved("a");
    store.markResolved("b");

    expect(store.removeResolved("thr").map((removed) => removed.id)).toEqual(["a", "b"]);
    expect(store.insert(annotation("c", 1)).number).toBe(1);
  });

  it("lists annotations by URL without the hash", () => {
    const store = setup();
    store.insert(annotation("a", 1, { url: "https://example.com/a#top" }));
    store.insert(annotation("b", 2, { url: "https://example.com/a?tab=2" }));

    expect(
      store.listForUrl("thr", "https://example.com/a#bottom").map((found) => found.id),
    ).toEqual(["a"]);
    expect(store.listForUrl("thr", "https://example.com/a?tab=2").map((found) => found.id)).toEqual(
      ["b"],
    );
    expect(store.listForThread("thr")).toHaveLength(2);
  });

  it("removes only resolved annotations of the thread", () => {
    const store = setup();
    store.insert(annotation("a", 1));
    store.insert(annotation("b", 2));
    store.insert(annotation("c", 1, { threadId: "other" }));
    store.markResolved("a");
    store.markResolved("c");

    expect(store.removeResolved("thr").map((removed) => removed.id)).toEqual(["a"]);
    expect(store.listForThread("thr").map((found) => found.id)).toEqual(["b"]);
    expect(store.get("c")?.resolvedAt).toBe(1000);
  });
});

describe("urlKey", () => {
  it.each([
    ["https://example.com/a", "https://example.com/a"],
    ["https://example.com/a#x", "https://example.com/a"],
    ["https://example.com/a?q=1#x", "https://example.com/a?q=1"],
    ["https://example.com/a?q=1", "https://example.com/a?q=1"],
  ])("maps %s to %s", (url, key) => {
    expect(urlKey(url)).toBe(key);
  });
});
