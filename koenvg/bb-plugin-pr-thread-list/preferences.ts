import type { ListOptions } from "./list-model";

export const STORAGE_KEY = "bb-plugin-pr-thread-list:preferences:v1";
export const DEFAULT_PREFERENCES: ListOptions = {
  tab: "attention",
  mode: "project",
  lifecycles: ["active"],
  sort: "updated",
  direction: "desc",
  collapsedGroups: [],
  collapsedThreads: [],
};

type Store = Pick<Storage, "getItem" | "setItem">;
const localStore = (): Store | undefined => {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
};
const oneOf = <T extends string>(value: unknown, choices: readonly T[]): value is T =>
  typeof value === "string" && choices.includes(value as T);
const ids = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

export function readPreferences(storage: Store | undefined = localStore()): ListOptions {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object" || !("version" in parsed) || parsed.version !== 1)
      return DEFAULT_PREFERENCES;
    const value = parsed as Record<string, unknown>;
    const lifecycles = Array.isArray(value.lifecycles)
      ? value.lifecycles.filter((v): v is "active" | "archived" => oneOf(v, ["active", "archived"]))
      : [];
    return {
      tab: oneOf(value.tab, ["attention", "inflight", "all"]) ? value.tab : DEFAULT_PREFERENCES.tab,
      mode: oneOf(value.mode, ["project", "machine", "section"])
        ? value.mode
        : DEFAULT_PREFERENCES.mode,
      lifecycles: lifecycles.length > 0 ? [...new Set(lifecycles)] : DEFAULT_PREFERENCES.lifecycles,
      sort: oneOf(value.sort, ["updated", "created", "title"])
        ? value.sort
        : DEFAULT_PREFERENCES.sort,
      direction: oneOf(value.direction, ["asc", "desc"])
        ? value.direction
        : DEFAULT_PREFERENCES.direction,
      collapsedGroups: ids(value.collapsedGroups),
      collapsedThreads: ids(value.collapsedThreads),
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function savePreferences(
  value: ListOptions,
  storage: Store | undefined = localStore(),
): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify({ version: 1, ...value }));
  } catch {
    /* A blocked client store must not break navigation. */
  }
}
