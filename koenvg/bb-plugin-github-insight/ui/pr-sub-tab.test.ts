import { afterEach, describe, expect, it } from "vitest";
import { forgetSubTabs, rememberedSubTab, rememberSubTab } from "./pr-sub-tab";

afterEach(forgetSubTabs);

describe("PR sub-tab memory", () => {
  it("starts a thread on Overview", () => {
    expect(rememberedSubTab("thr_new")).toBe("overview");
  });

  it("reads back the selected sub-tab", () => {
    rememberSubTab("thr_1", "files");

    expect(rememberedSubTab("thr_1")).toBe("files");
  });

  it("keeps threads separate", () => {
    rememberSubTab("thr_a", "files");

    expect(rememberedSubTab("thr_b")).toBe("overview");
  });
});
