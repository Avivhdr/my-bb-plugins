import { describe, expect, it } from "vitest";
import { linkJiraKeys } from "./jira-links";

const url = (key: string) => `https://engineering-collibra.atlassian.net/browse/${key}`;

describe("linkJiraKeys", () => {
  it("links DEV and PUX keys", () => {
    expect(linkJiraKeys("## JIRA reference\n\nDEV-231874")).toBe(
      `## JIRA reference\n\n[DEV-231874](${url("DEV-231874")})`,
    );
    expect(linkJiraKeys("Fixes PUX-42.")).toBe(`Fixes [PUX-42](${url("PUX-42")}).`);
  });

  it("links every key on a line", () => {
    expect(linkJiraKeys("DEV-1, DEV-2")).toBe(`[DEV-1](${url("DEV-1")}), [DEV-2](${url("DEV-2")})`);
  });

  it.each([
    ["an existing link", `[DEV-1](${url("DEV-1")})`],
    ["a link whose label is a key", "[DEV-1](https://example.com)"],
    ["a bare URL", url("DEV-1")],
    ["an autolink", `<${url("DEV-1")}>`],
    ["inline code", "run `git log --grep DEV-1`"],
    ["a branch name", "kvg/DEV-1-fix"],
    ["a longer word", "XDEV-1 DEV-1a"],
    ["lowercase", "dev-1"],
    ["another project", "ABC-1"],
  ])("leaves %s alone", (_name, text) => {
    expect(linkJiraKeys(text)).toBe(text);
  });

  it("leaves fenced code alone", () => {
    const text = "````\nDEV-1\n```\nstill code DEV-2\n````\nDEV-3";
    expect(linkJiraKeys(text)).toBe(text.replace("\nDEV-3", `\n[DEV-3](${url("DEV-3")})`));
  });
});
