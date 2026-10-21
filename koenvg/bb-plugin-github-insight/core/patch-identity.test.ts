import { describe, expect, it } from "vitest";
import { patchIdentity } from "./patch-identity";

const PATCH = "@@ -1,3 +1,3 @@\n keep\n-old\n+new\n keep\n";
const SAME_COUNTS_EDIT = "@@ -1,3 +1,3 @@\n keep\n-old\n+newer\n keep\n";

describe("patchIdentity", () => {
  it("is the same for the same patch", () => {
    expect(patchIdentity(PATCH)).toBe(patchIdentity(`${PATCH}`));
  });

  it("changes for an edit with the same line counts", () => {
    expect(patchIdentity(SAME_COUNTS_EDIT)).not.toBe(patchIdentity(PATCH));
  });

  it("changes for one changed character", () => {
    expect(patchIdentity(PATCH.replace("new", "nex"))).not.toBe(patchIdentity(PATCH));
  });
});
