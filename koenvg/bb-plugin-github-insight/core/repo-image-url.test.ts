import { describe, expect, it } from "vitest";
import { parseRepoImageUrl } from "./repo-image-url";

const SHA = "ddd9a67392b21c016ce0009d44df368e9ff6460e";

describe("parseRepoImageUrl", () => {
  it("reads a raw link on github.com", () => {
    expect(
      parseRepoImageUrl(`https://github.com/collibra/frontend/raw/${SHA}/ac-image-AC-1-1-page.png`),
    ).toEqual({ owner: "collibra", repo: "frontend", ref: SHA, path: "ac-image-AC-1-1-page.png" });
  });

  it("reads a blob link with raw=true and a nested, encoded path", () => {
    expect(
      parseRepoImageUrl("https://github.com/acme/api/blob/main/docs/my%20shot.png?raw=true"),
    ).toEqual({ owner: "acme", repo: "api", ref: "main", path: "docs/my shot.png" });
  });

  it("reads a raw.githubusercontent.com link", () => {
    expect(parseRepoImageUrl(`https://raw.githubusercontent.com/acme/api/${SHA}/a/b.jpg`)).toEqual({
      owner: "acme",
      repo: "api",
      ref: SHA,
      path: "a/b.jpg",
    });
  });

  it.each([
    ["a blob page without raw=true", "https://github.com/acme/api/blob/main/a.png"],
    [
      "an attachment",
      "https://github.com/user-attachments/assets/0f1e2d3c-1111-2222-3333-444455556666",
    ],
    ["another host", "https://example.com/acme/api/raw/main/a.png"],
    ["plain http", "http://github.com/acme/api/raw/main/a.png"],
    ["a file that is not a raster image", "https://github.com/acme/api/raw/main/a.svg"],
    ["path traversal", "https://raw.githubusercontent.com/acme/api/main/%2E%2E/secret.png"],
    ["a malformed escape", "https://github.com/acme/api/raw/main/%E0%A4%A.png"],
    ["not a URL", "a.png"],
  ])("ignores %s", (_, url) => {
    expect(parseRepoImageUrl(url)).toBeNull();
  });
});
