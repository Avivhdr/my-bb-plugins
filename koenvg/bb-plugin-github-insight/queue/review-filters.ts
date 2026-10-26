import type { PluginKvStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  DEFAULT_REVIEW_FILTERS,
  reviewFiltersSchema,
  type ReviewFilters,
} from "../core/review-filters";

const KEY = "review-filters";

const storedFiltersSchema = z.object({ v: z.literal(2), filters: reviewFiltersSchema });

/** Version 1 had Direct and Team only, without a Teammates layer. */
const firstFiltersSchema = z.object({
  v: z.literal(1),
  filters: z.object({
    layers: z.array(z.object({ name: z.string(), excludeRepos: z.array(z.string()) })),
    excludeRepos: z.array(z.string()),
    skipLabels: z.array(z.string()),
  }),
});

/** Keeps the hidden repos and skip labels of a version 1 entry on the current default layers. */
function fromFirstVersion(stored: z.infer<typeof firstFiltersSchema>["filters"]): ReviewFilters {
  const hiddenByLayer = new Map(stored.layers.map((layer) => [layer.name, layer.excludeRepos]));
  return {
    ...DEFAULT_REVIEW_FILTERS,
    layers: DEFAULT_REVIEW_FILTERS.layers.map((layer) => ({
      ...layer,
      excludeRepos: hiddenByLayer.get(layer.name) ?? [],
    })),
    excludeRepos: stored.excludeRepos,
    skipLabels: stored.skipLabels,
  };
}

export function createReviewFiltersStore(kv: Pick<PluginKvStorage, "get" | "set">) {
  return {
    /** The saved filters, or the defaults when none are saved or the entry is of another version. */
    async read(): Promise<ReviewFilters> {
      const stored = await kv.get(KEY);
      const entry = storedFiltersSchema.safeParse(stored);
      if (entry.success) return entry.data.filters;
      const first = firstFiltersSchema.safeParse(stored);
      return first.success ? fromFirstVersion(first.data.filters) : DEFAULT_REVIEW_FILTERS;
    },

    save: (filters: ReviewFilters) => kv.set(KEY, { v: 2, filters }),
  };
}
