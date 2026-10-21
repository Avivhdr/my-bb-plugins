import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";

const PROJECT = {
  id: "proj_1",
  name: "acme",
  kind: "standard",
  gitRemoteUrl: "git@github.com:acme/repo.git",
  createdAt: 0,
  updatedAt: 0,
  sources: [],
};

const EMPTY_GRAPHQL = {
  data: {
    repository: {
      issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
    },
  },
};

const OPEN_ISSUES = [
  { number: 1, title: "A bug", body: "Crashes on save", state: "open", html_url: "u/1", labels: [{ name: "bug", color: "ff0000" }] },
  { number: 2, title: "A PR", body: null, state: "open", html_url: "u/2", labels: [], pull_request: { url: "x" } },
  { number: 3, title: "Unlabelled", body: null, state: "open", html_url: "u/3", labels: [] },
];

const REPO_LABELS = [
  { name: "bug", color: "ff0000" },
  { name: "stale", color: "cccccc" },
];

/** Route each GitHub call by URL so tests do not depend on request order. */
function stubGitHub(routes: Record<string, unknown> = {}) {
  const all: Record<string, unknown> = {
    "/graphql": EMPTY_GRAPHQL,
    "/issues?state=open": OPEN_ISSUES,
    "/labels?per_page": REPO_LABELS,
    ...routes,
  };
  const spy = vi.fn(async (url: string, _init?: RequestInit) => {
    const match = Object.keys(all).find((fragment) => url.includes(fragment));
    if (!match) throw new Error(`unstubbed GitHub call: ${url}`);
    return new Response(JSON.stringify(all[match]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

async function setup(
  options: {
    settings?: Record<string, string>;
    ghToken?: string | null;
    liveThreadIds?: string[];
    project?: { gitRemoteUrl?: string | null };
  } = {},
) {
  const hostCalls: string[] = [];
  const { bb, harness } = createFakePluginHost({
    pluginId: "issues",
    settings: options.settings,
    sdk: {
      projects: { get: async () => ({ ...PROJECT, ...options.project }) as never },
      system: { config: async () => ({ primaryHostId: "host_1" }) as never },
      threads: {
        list: async () => (options.liveThreadIds ?? []).map((id) => makeThreadResponse({ id })) as never,
        spawn: async () => makeThreadResponse({ id: "thr_new" }) as never,
      },
    },
    experimental_callHostRpc: async ({ method, hostId }) => {
      hostCalls.push(`${method}@${hostId}`);
      const token = options.ghToken === undefined ? "gho_from_gh" : options.ghToken;
      return { token, error: token ? null : "not logged in" };
    },
  });
  await plugin(bb);
  return { bb, harness, hostCalls };
}

function authHeader(spy: ReturnType<typeof stubGitHub>): string | undefined {
  const init = spy.mock.calls[0]?.[1];
  return (init?.headers as Record<string, string> | undefined)?.Authorization;
}

afterEach(() => vi.unstubAllGlobals());

describe("registration", () => {
  it("registers every board method and the bb issues command", async () => {
    const { harness } = await setup();
    expect([...harness.registrations.rpcMethods].sort()).toEqual(
      [
        "issues_ai_status",
        "issues_create_issue",
        "issues_edit_issue",
        "issues_get_board",
        "issues_get_collapsed_columns",
        "issues_get_config",
        "issues_refine_ticket",
        "issues_set_collapsed_columns",
        "issues_set_column_labels",
        "issues_set_repo",
        "issues_set_value",
        "issues_start_thread",
        "issues_update_label_color",
      ].sort(),
    );
  });
});

describe("issues_get_board", () => {
  it("drops pull requests and seeds columns from the labels in use", async () => {
    const { harness } = await setup();
    stubGitHub();

    const board = (await harness.behavior.callRpc("issues_get_board", { projectId: "proj_1" })) as {
      repo: unknown;
      issues: { number: number }[];
      columnLabels: string[];
      threadLinks: unknown;
    };

    expect(board.repo).toEqual({ owner: "acme", name: "repo" });
    expect(board.issues.map((issue) => issue.number)).toEqual([1, 3]);
    expect(board.columnLabels).toEqual(["bug"]);
    expect(board.threadLinks).toEqual({});
  });

  it("attaches open blocking links from GitHub's issue dependencies", async () => {
    const { harness } = await setup();
    const dependency = (number: number) => ({
      number,
      title: `Issue ${number}`,
      state: "OPEN",
      url: `https://github.com/acme/repo/issues/${number}`,
      repository: { nameWithOwner: "acme/repo" },
    });
    stubGitHub({
      "/graphql": {
        data: {
          repository: {
            issues: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [
                {
                  number: 1,
                  closedByPullRequestsReferences: { nodes: [] },
                  issueDependenciesSummary: { blockedBy: 0, blocking: 1 },
                  blockedBy: { nodes: [] },
                  blocking: { nodes: [dependency(3)] },
                },
                {
                  number: 3,
                  closedByPullRequestsReferences: { nodes: [] },
                  issueDependenciesSummary: { blockedBy: 1, blocking: 0 },
                  blockedBy: { nodes: [dependency(1)] },
                  blocking: { nodes: [] },
                },
              ],
            },
          },
        },
      },
    });

    const board = (await harness.behavior.callRpc("issues_get_board", { projectId: "proj_1" })) as {
      issues: { number: number; blocked_by: { number: number }[]; blocking_open_count: number }[];
    };

    const [first, third] = board.issues;
    expect(first!.blocking_open_count).toBe(1);
    expect(third!.blocked_by.map((issue) => issue.number)).toEqual([1]);
  });

  it("uses the gh token when no token is configured", async () => {
    const { harness, hostCalls } = await setup();
    const spy = stubGitHub();

    await harness.behavior.callRpc("issues_get_board", { projectId: "proj_1" });

    expect(hostCalls).toEqual(["ghAuthToken@host_1"]);
    expect(authHeader(spy)).toBe("token gho_from_gh");
  });

  it("prefers a configured token over gh", async () => {
    const { harness, hostCalls } = await setup({ settings: { githubToken: " ghp_configured " } });
    const spy = stubGitHub();

    await harness.behavior.callRpc("issues_get_board", { projectId: "proj_1" });

    expect(hostCalls).toEqual([]);
    expect(authHeader(spy)).toBe("token ghp_configured");
  });

  it("says how to sign in when there is no token anywhere", async () => {
    const { harness } = await setup({ ghToken: null });
    stubGitHub();

    await expect(harness.behavior.callRpc("issues_get_board", { projectId: "proj_1" })).rejects.toThrow(
      /gh auth login/,
    );
  });

  it("explains a project with no git remote, and accepts an override", async () => {
    const { harness } = await setup({ project: { gitRemoteUrl: null } });
    stubGitHub();

    await expect(harness.behavior.callRpc("issues_get_board", { projectId: "proj_1" })).rejects.toThrow(
      /no git remote/,
    );

    await harness.behavior.callRpc("issues_set_repo", { projectId: "proj_1", repo: "acme/other" });
    const board = (await harness.behavior.callRpc("issues_get_board", { projectId: "proj_1" })) as {
      repo: unknown;
    };
    expect(board.repo).toEqual({ owner: "acme", name: "other" });
  });

  it("starts the board over when the repository changes", async () => {
    const { harness } = await setup();
    stubGitHub();
    await harness.behavior.callRpc("issues_get_board", { projectId: "proj_1" });
    await harness.behavior.callRpc("issues_set_value", { projectId: "proj_1", issueNumber: 1, value: 7 });
    await harness.behavior.callRpc("issues_set_column_labels", { projectId: "proj_1", labels: ["stale"] });

    // Same repo, different spelling: nothing is lost.
    await harness.behavior.callRpc("issues_set_repo", { projectId: "proj_1", repo: "ACME/repo" });
    let board = (await harness.behavior.callRpc("issues_get_board", { projectId: "proj_1" })) as {
      values: unknown;
      columnLabels: string[];
    };
    expect(board.values).toEqual({ "1": 7 });
    expect(board.columnLabels).toEqual(["stale"]);

    await harness.behavior.callRpc("issues_set_repo", { projectId: "proj_1", repo: "acme/other" });
    board = (await harness.behavior.callRpc("issues_get_board", { projectId: "proj_1" })) as {
      values: unknown;
      columnLabels: string[];
    };
    expect(board.values).toEqual({});
    expect(board.columnLabels).toEqual(["bug"]);
  });

  it("rejects an override that is not owner/name", async () => {
    const { harness } = await setup();
    await expect(
      harness.behavior.callRpc("issues_set_repo", { projectId: "proj_1", repo: "nope" }),
    ).rejects.toThrow(/owner\/name/);
  });
});

describe("values", () => {
  it("round-trips a value onto the board", async () => {
    const { harness } = await setup();
    stubGitHub();

    await harness.behavior.callRpc("issues_set_value", { projectId: "proj_1", issueNumber: 1, value: 7 });
    const board = (await harness.behavior.callRpc("issues_get_board", { projectId: "proj_1" })) as {
      values: Record<string, number>;
    };

    expect(board.values).toEqual({ "1": 7 });
  });

  it("rejects a value outside 1..10 at the boundary", async () => {
    const { harness } = await setup();
    await expect(
      harness.behavior.callRpc("issues_set_value", { projectId: "proj_1", issueNumber: 1, value: 11 }),
    ).rejects.toThrow();
  });
});

describe("issues_start_thread", () => {
  it("spawns a thread tagged with the issue and links it on the board", async () => {
    const { harness } = await setup({ liveThreadIds: ["thr_new"] });
    stubGitHub();

    const result = await harness.behavior.callRpc("issues_start_thread", {
      projectId: "proj_1",
      issueNumber: 1,
      title: "A bug",
    });

    expect(result).toEqual({ threadId: "thr_new" });
    const [spawn] = harness.inspection.sdk.callsTo("threads.spawn") as unknown as [[Record<string, unknown>]];
    expect(spawn[0]).toMatchObject({
      projectId: "proj_1",
      environment: { type: "project-default" },
      title: "#1 A bug",
      prompt: "Implement GitHub issue #1: A bug\n\nhttps://github.com/acme/repo/issues/1",
      pluginMetadata: { repo: "acme/repo", issueNumber: 1 },
    });

    const board = (await harness.behavior.callRpc("issues_get_board", { projectId: "proj_1" })) as {
      threadLinks: unknown;
    };
    expect(board.threadLinks).toEqual({ "1": { threadId: "thr_new", title: "A bug" } });
  });

  it("drops the link once its thread is archived or deleted", async () => {
    const { harness } = await setup({ liveThreadIds: [] });
    stubGitHub();

    await harness.behavior.callRpc("issues_start_thread", { projectId: "proj_1", issueNumber: 1, title: "A bug" });
    const board = (await harness.behavior.callRpc("issues_get_board", { projectId: "proj_1" })) as {
      threadLinks: unknown;
    };

    expect(board.threadLinks).toEqual({});
  });
});

describe("refine", () => {
  it("reports Refine as unavailable until a key is set", async () => {
    expect(await (await setup()).harness.behavior.callRpc("issues_ai_status", null)).toEqual({ ready: false });
    expect(
      await (await setup({ settings: { groqApiKey: "gsk_1" } })).harness.behavior.callRpc("issues_ai_status", null),
    ).toEqual({ ready: true });
  });

  it("tells the user where to add a key", async () => {
    const { harness } = await setup();
    harness.sdk.stub("projects.fileContent", async () => {
      throw new Error("no readme");
    });

    await expect(
      harness.behavior.callRpc("issues_refine_ticket", {
        projectId: "proj_1",
        repo: "acme/repo",
        repoLabels: [],
        text: "add dark mode",
        draft: null,
        feedback: "",
      }),
    ).rejects.toThrow(/Settings → Plugins → Issues/);
  });
});

describe("bb issues", () => {
  it("lists open issues for the thread's project", async () => {
    const { harness } = await setup();
    stubGitHub();
    await harness.behavior.callRpc("issues_set_value", { projectId: "proj_1", issueNumber: 1, value: 9 });

    const result = await harness.behavior.runCli(["list"], { projectId: "proj_1" });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("#1 [bug] A bug (value 9)\n#3 Unlabelled");
  });

  it("filters by label and emits JSON", async () => {
    const { harness } = await setup();
    stubGitHub();

    const result = await harness.behavior.runCli(["list", "--label", "bug", "--json"], { projectId: "proj_1" });

    expect(JSON.parse(result.stdout)).toMatchObject({
      repo: "acme/repo",
      total: 1,
      issues: [{ number: 1, labels: ["bug"], value: null }],
    });
  });

  it("shows one issue with its body", async () => {
    const { harness } = await setup();
    stubGitHub();

    const result = await harness.behavior.runCli(["show", "#1"], { projectId: "proj_1" });

    expect(result.stdout).toContain("#1 A bug");
    expect(result.stdout).toContain("https://github.com/acme/repo/issues/1");
    expect(result.stdout).toContain("Crashes on save");
  });

  it("asks for a project outside a thread", async () => {
    const { harness } = await setup();

    const result = await harness.behavior.runCli(["list"]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("--project");
  });
});

describe("collapsed columns", () => {
  it("stores the collapsed column labels per project", async () => {
    const { harness } = await setup();

    expect(await harness.behavior.callRpc("issues_get_collapsed_columns", { projectId: "proj_1" })).toEqual([]);
    await harness.behavior.callRpc("issues_set_collapsed_columns", { projectId: "proj_1", labels: ["bug", ""] });

    expect(await harness.behavior.callRpc("issues_get_collapsed_columns", { projectId: "proj_1" })).toEqual([
      "bug",
      "",
    ]);
  });
});
