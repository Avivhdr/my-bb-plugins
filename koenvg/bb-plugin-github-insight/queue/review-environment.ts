import type { NewThreadRequest } from "@get-bb/plugin-sdk";

const SHARED_ENVIRONMENT_PROVIDERS: ReadonlySet<string> = new Set([
  "project-checkout",
  "personal-workspace",
]);

export function isSharedEnvironment(environment: NewThreadRequest["environment"]): boolean {
  switch (environment.type) {
    case "reuse":
    case "project-default":
      return true;
    case "host":
      return environment.workspace.type !== "managed-worktree";
    case "provider":
      return SHARED_ENVIRONMENT_PROVIDERS.has(environment.environmentProviderId);
  }
}
