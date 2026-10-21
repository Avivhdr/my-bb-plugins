import { describe, expect, it } from "vitest";
import { prHeadArgs } from "./pr-head-query";

describe("prHeadArgs", () => {
  it("asks for the PR node id, head commit, state, author flag, and viewer review", () => {
    expect(prHeadArgs({ owner: "koenvg", repo: "bb-plugins", number: 43 })).toMatchSnapshot();
  });
});
