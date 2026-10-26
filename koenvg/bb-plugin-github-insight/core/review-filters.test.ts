import { describe, expect, it } from "vitest";
import {
  DEFAULT_REVIEW_FILTERS,
  keepsAuthor,
  layerSearchQuery,
  setRepoHidden,
  skipLabelOf,
  type ReviewFilters,
} from "./review-filters";

const direct = DEFAULT_REVIEW_FILTERS.layers[0]!;

describe("DEFAULT_REVIEW_FILTERS", () => {
  it("splits requests to your teams by whether a teammate wrote the PR", () => {
    const team =
      "is:pr is:open draft:false archived:false review-requested:@me -user-review-requested:@me";

    expect(
      DEFAULT_REVIEW_FILTERS.layers.map((layer) => [layer.name, layer.query, layer.teammates]),
    ).toEqual([
      ["Direct", "is:pr is:open draft:false archived:false user-review-requested:@me", null],
      ["Teammates", team, "only"],
      ["Team", team, "exclude"],
    ]);
    expect(DEFAULT_REVIEW_FILTERS.teammatesTeam).toBeNull();
  });
});

describe("layerSearchQuery", () => {
  it("sends the layer query as it is when nothing is hidden", () => {
    expect(layerSearchQuery(direct, [])).toBe(direct.query);
  });

  it("adds a -repo qualifier for each repo hidden from the layer or everywhere, once", () => {
    const layer = { ...direct, excludeRepos: ["acme/web", "acme/api"] };

    expect(layerSearchQuery(layer, ["acme/api", "acme/docs"])).toBe(
      `${direct.query} -repo:acme/api -repo:acme/docs -repo:acme/web`,
    );
  });
});

describe("skipLabelOf", () => {
  it("finds a skip label in any case", () => {
    expect(skipLabelOf(["docs", "do not review"], ["DO NOT REVIEW"])).toBe("do not review");
  });

  it("returns null when no label matches", () => {
    expect(skipLabelOf(["docs"], ["DO NOT REVIEW"])).toBeNull();
    expect(skipLabelOf(["DO NOT REVIEW"], [])).toBeNull();
  });
});

describe("setRepoHidden", () => {
  const filters: ReviewFilters = DEFAULT_REVIEW_FILTERS;

  it("hides a repo from one layer, in lowercase", () => {
    const next = setRepoHidden(filters, "Acme/Web", "Team", true);

    expect(next.layers.map((layer) => layer.excludeRepos)).toEqual([[], [], ["acme/web"]]);
    expect(next.excludeRepos).toEqual([]);
  });

  it("hides a repo everywhere without touching the layers", () => {
    const next = setRepoHidden(filters, "acme/web", null, true);

    expect(next.excludeRepos).toEqual(["acme/web"]);
    expect(next.layers.map((layer) => layer.excludeRepos)).toEqual([[], [], []]);
  });

  it("does not add a repo twice", () => {
    const once = setRepoHidden(filters, "acme/web", "Direct", true);

    expect(setRepoHidden(once, "acme/web", "Direct", true).layers[0]!.excludeRepos).toEqual([
      "acme/web",
    ]);
  });

  it("shows a repo again in one layer only", () => {
    const hidden = setRepoHidden(
      setRepoHidden(filters, "acme/web", "Direct", true),
      "acme/web",
      "Team",
      true,
    );

    const next = setRepoHidden(hidden, "acme/web", "Team", false);

    expect(next.layers.map((layer) => layer.excludeRepos)).toEqual([["acme/web"], [], []]);
  });

  it("shows a repo hidden everywhere in every layer again", () => {
    const hidden = setRepoHidden(
      setRepoHidden(filters, "acme/web", "Direct", true),
      "acme/web",
      null,
      true,
    );

    const next = setRepoHidden(hidden, "acme/web", null, false);

    expect(next.excludeRepos).toEqual([]);
    expect(next.layers.map((layer) => layer.excludeRepos)).toEqual([[], [], []]);
  });
});

describe("keepsAuthor", () => {
  const [, teammatesLayer, teamLayer] = DEFAULT_REVIEW_FILTERS.layers;
  const mates = new Set(["gbrari"]);

  it("keeps a teammate's PR in Teammates only, in any case", () => {
    expect(keepsAuthor(teammatesLayer!, "GBrari", mates)).toBe(true);
    expect(keepsAuthor(teamLayer!, "GBrari", mates)).toBe(false);
  });

  it("keeps another author's PR, or one by a deleted user, in Team only", () => {
    for (const author of ["samih7", null]) {
      expect(keepsAuthor(teammatesLayer!, author, mates)).toBe(false);
      expect(keepsAuthor(teamLayer!, author, mates)).toBe(true);
    }
  });

  it("puts every PR in Team while the teammates are unknown", () => {
    expect(keepsAuthor(teammatesLayer!, "gbrari", null)).toBe(false);
    expect(keepsAuthor(teamLayer!, "gbrari", null)).toBe(true);
  });

  it("keeps every PR in a layer without a teammate filter", () => {
    expect(keepsAuthor(direct, "samih7", mates)).toBe(true);
  });
});
