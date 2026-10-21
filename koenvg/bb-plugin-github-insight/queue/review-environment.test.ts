import type { NewThreadRequest } from "@get-bb/plugin-sdk";
import { describe, expect, it } from "vitest";
import { isSharedEnvironment } from "./review-environment";

type Environment = NewThreadRequest["environment"];

const provider = (environmentProviderId: string): Environment => ({
  type: "provider",
  environmentProviderId,
  inputs: {},
});

describe("isSharedEnvironment", () => {
  it.each<[string, Environment]>([
    ["reuse", { type: "reuse", environmentId: "env_1" }],
    ["project-default", { type: "project-default" }],
    ["host unmanaged", { type: "host", workspace: { type: "unmanaged", path: null } }],
    ["host personal", { type: "host", workspace: { type: "personal" } }],
    ["project-checkout provider", provider("project-checkout")],
    ["personal-workspace provider", provider("personal-workspace")],
  ])("is shared for %s", (_, environment) => {
    expect(isSharedEnvironment(environment)).toBe(true);
  });

  it.each<[string, Environment]>([
    [
      "host managed-worktree",
      { type: "host", workspace: { type: "managed-worktree", baseBranch: { kind: "default" } } },
    ],
    ["git-worktree provider", provider("git-worktree")],
    ["unknown provider", provider("remote-sandbox")],
  ])("is not shared for %s", (_, environment) => {
    expect(isSharedEnvironment(environment)).toBe(false);
  });
});
