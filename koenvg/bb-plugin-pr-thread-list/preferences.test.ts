import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES, readPreferences, savePreferences, STORAGE_KEY } from "./preferences";

const memory = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
};

describe("list preferences", () => {
  it("retains validated non-default choices under a versioned plugin key", () => {
    const storage = memory();
    const next = {
      ...DEFAULT_PREFERENCES,
      tab: "all" as const,
      mode: "machine" as const,
      lifecycles: ["active", "archived"] as const,
      collapsedGroups: ["machine:m1"],
    };
    savePreferences(next, storage);
    expect(storage.getItem(STORAGE_KEY)).toContain('"version":1');
    expect(readPreferences(storage)).toEqual(next);
  });

  it("ignores malformed, unsupported and foreign fields", () => {
    const storage = memory();
    storage.setItem(STORAGE_KEY, "not json");
    expect(readPreferences(storage)).toEqual(DEFAULT_PREFERENCES);
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        mode: "invalid",
        tab: "focus",
        lifecycles: [],
        sort: "title",
        collapsedGroups: [4, "project:p1"],
        foreign: "data",
      }),
    );
    expect(readPreferences(storage)).toEqual({
      ...DEFAULT_PREFERENCES,
      sort: "title",
      collapsedGroups: ["project:p1"],
    });
  });

  it("opens on Needs attention when no tab was saved", () => {
    const storage = memory();
    expect(readPreferences(storage).tab).toBe("attention");
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, mode: "machine" }));
    expect(readPreferences(storage)).toEqual({
      ...DEFAULT_PREFERENCES,
      mode: "machine",
      tab: "attention",
    });
  });
});
