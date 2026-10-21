// bb-plugin-issues: a per-project Kanban board over GitHub Issues.
//
// The board's data comes from two places. GitHub holds the issues, labels, and
// linked pull requests; the plugin's kv store holds what GitHub does not: each
// issue's 1..10 value, the curated column order, the threads started from issues,
// and an optional repository override per project.
import {
  PluginCliError,
  cliCommand,
  defineCli,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import { hostContract, rpcContract } from "./contract";
import { describeAiError, refineTicket, reviseTicket } from "./core/ai";
import { loadRepoContext } from "./core/ai/context";
import {
  aiSettingsFrom,
  hasUsableProvider,
  resolveProvider,
} from "./core/aiSettings";
import {
  clearRepoBoardState,
  computeLabelUsage,
  keepLiveThreadLinks,
  readColumnLabels,
  readRepoOverride,
  readThreadLinks,
  readValues,
  resolveColumnLabels,
  writeColumnLabels,
  writeRepoOverride,
  writeThreadLink,
  writeValue,
  type ThreadLinks,
} from "./core/boardStore";
import {
  createIssue,
  editIssue,
  listLabels,
  listLinkedPullRequestsByIssue,
  listOpenIssues,
  updateLabelColor,
} from "./core/github/client";
import { parseOwnerName, resolveRepoRef } from "./core/github/repoRef";
import { buildIssueThreadPrompt, issueThreadTitle, issueUrl } from "./core/issueThread";
import { normalizeLabelColor } from "./core/labelColors";
import { kvProjectStorage } from "./core/projectStorage";
import type { Issue, RepoRef } from "./core/types";

const NO_GITHUB_TOKEN =
  "No GitHub token found. Run `gh auth login` on the bb server machine, or set a token in Settings → Plugins → Issues.";

/** How long a token read from `gh` is reused before asking `gh` again. */
const GH_TOKEN_TTL_MS = 5 * 60 * 1000;

function sameRepo(a: RepoRef | null, b: RepoRef | null): boolean {
  if (!a || !b) return a === b;
  return a.owner.toLowerCase() === b.owner.toLowerCase() && a.name.toLowerCase() === b.name.toLowerCase();
}

/** Most issues `bb issues list` prints before telling the agent to narrow the query. */
const CLI_LIST_LIMIT = 200;

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    githubToken: {
      type: "string",
      label: "GitHub token",
      description:
        "Optional. Leave empty to use the token from `gh auth login` on the bb server machine.",
      secret: true,
    },
    anthropicApiKey: {
      type: "string",
      label: "Anthropic API key",
      description: "Powers Refine in the create dialog.",
      secret: true,
    },
    groqApiKey: {
      type: "string",
      label: "Groq API key",
      description: "Powers Refine when there is no Anthropic key, or when Groq is preferred.",
      secret: true,
    },
    aiProvider: {
      type: "select",
      label: "Preferred AI provider",
      description: "Used when both keys are set.",
      options: ["anthropic", "groq"],
      default: "anthropic",
    },
  });

  const storage = kvProjectStorage(bb.storage.kv);
  const host = bb.hosts.experimental_client({ contract: hostContract });

  let ghToken: { token: string; at: number } | null = null;

  async function githubToken(): Promise<string> {
    const { githubToken: configured } = await settings.get();
    if (typeof configured === "string" && configured.trim()) {
      return configured.trim();
    }
    if (ghToken && Date.now() - ghToken.at < GH_TOKEN_TTL_MS) return ghToken.token;

    const { primaryHostId } = await bb.sdk.system.config();
    if (!primaryHostId) throw new Error(NO_GITHUB_TOKEN);
    const result = await host.call("ghAuthToken", null, { hostId: primaryHostId });
    if (!result.token) {
      bb.log.warn(`gh auth token failed: ${result.error ?? "no token"}`);
      throw new Error(NO_GITHUB_TOKEN);
    }
    ghToken = { token: result.token, at: Date.now() };
    return result.token;
  }

  async function repoFor(projectId: string): Promise<RepoRef> {
    const [project, override] = await Promise.all([
      bb.sdk.projects.get({ projectId }),
      readRepoOverride(storage, projectId),
    ]);
    return resolveRepoRef({
      projectName: project.name,
      override,
      gitRemoteUrl: project.gitRemoteUrl,
    });
  }

  /** Both things every GitHub-touching method needs, resolved together. */
  async function connect(projectId: string): Promise<{ repo: RepoRef; token: string }> {
    const [repo, token] = await Promise.all([repoFor(projectId), githubToken()]);
    return { repo, token };
  }

  /**
   * Links whose thread still exists and is not archived. A failed thread lookup keeps
   * every stored link: a chip that opens a stale thread beats chips that vanish
   * whenever the lookup hiccups.
   */
  async function liveThreadLinks(projectId: string): Promise<ThreadLinks> {
    const links = await readThreadLinks(storage, projectId);
    if (Object.keys(links).length === 0) return links;
    try {
      const threads = await bb.sdk.threads.list({
        projectId,
        originPluginId: bb.pluginId,
        archived: false,
        includeHidden: true,
        limit: 500,
      });
      return keepLiveThreadLinks(links, new Set(threads.map((thread) => thread.id)));
    } catch (error) {
      bb.log.warn(`could not list threads for ${projectId}: ${String(error)}`);
      return links;
    }
  }

  bb.rpc.register(rpcContract, {
    issues_get_board: async ({ projectId }) => {
      const { repo, token } = await connect(projectId);
      const [issues, labels, linkedByIssue] = await Promise.all([
        listOpenIssues(token, repo),
        listLabels(token, repo),
        listLinkedPullRequestsByIssue(token, repo),
      ]);
      const issuesWithLinks = issues.map((issue) => ({
        ...issue,
        linked_pull_requests: linkedByIssue.get(issue.number) ?? [],
      }));
      const [values, columnLabels, threadLinks] = await Promise.all([
        readValues(storage, projectId),
        resolveColumnLabels(storage, projectId, labels, issuesWithLinks),
        liveThreadLinks(projectId),
      ]);
      return { repo, issues: issuesWithLinks, labels, values, columnLabels, threadLinks };
    },

    issues_set_value: async ({ projectId, issueNumber, value }) => {
      await writeValue(storage, projectId, issueNumber, value);
      return null;
    },

    issues_get_config: async ({ projectId }) => {
      const { repo, token } = await connect(projectId);
      const [issues, labels] = await Promise.all([
        listOpenIssues(token, repo),
        listLabels(token, repo),
      ]);
      return {
        columnLabels: (await readColumnLabels(storage, projectId)) ?? [],
        labels: computeLabelUsage(labels, issues),
      };
    },

    issues_set_column_labels: async ({ projectId, labels }) => {
      await writeColumnLabels(storage, projectId, labels);
      return null;
    },

    issues_create_issue: async ({ projectId, title, body, labels }) => {
      const { repo, token } = await connect(projectId);
      return { issue: await createIssue(token, repo, { title, body, labels }) };
    },

    issues_edit_issue: async ({ projectId, number, ...input }) => {
      const { repo, token } = await connect(projectId);
      await editIssue(token, repo, number, input);
      return null;
    },

    issues_update_label_color: async ({ projectId, name, color }) => {
      const normalized = normalizeLabelColor(color);
      if (!normalized) throw new Error("color must be a six-digit hex color");
      const { repo, token } = await connect(projectId);
      await updateLabelColor(token, repo, name, normalized);
      return null;
    },

    // Refine drafts a ticket from a rough note, through whichever of Anthropic or Groq
    // the user has a key for. Without either, the dialog disables the button (see
    // issues_ai_status) rather than failing at call time.
    issues_refine_ticket: async (request) => {
      const ai = aiSettingsFrom(await settings.get());
      try {
        const context = await loadRepoContext((args) => bb.sdk.projects.fileContent(args), {
          projectId: request.projectId,
          repo: request.repo,
          repoLabels: request.repoLabels,
        });
        return request.draft
          ? await reviseTicket(ai, {
              draft: request.draft,
              feedback: request.feedback,
              note: request.text,
              context,
            })
          : await refineTicket(ai, request.text, context);
      } catch (error) {
        // Surface what the user can act on (a bad key, a rate limit) rather than a raw
        // SDK error. Which provider ran decides whose vocabulary the message speaks.
        throw new Error(describeAiError(error, resolveProvider(ai)));
      }
    },

    issues_ai_status: async () => ({
      ready: hasUsableProvider(aiSettingsFrom(await settings.get())),
    }),

    // Starts the thread right away so the board can link it to the issue. The
    // frontend's "Draft in new thread" is the path for choosing a provider or
    // environment first.
    issues_start_thread: async ({ projectId, issueNumber, title }) => {
      const repo = await repoFor(projectId);
      const slug = `${repo.owner}/${repo.name}`;
      const thread = await bb.sdk.threads.spawn({
        projectId,
        environment: { type: "project-default" },
        prompt: buildIssueThreadPrompt(slug, issueNumber, title),
        title: issueThreadTitle(issueNumber, title),
        pluginMetadata: { repo: slug, issueNumber },
      });
      await writeThreadLink(storage, projectId, issueNumber, {
        threadId: thread.id,
        title: title.trim() || null,
      });
      return { threadId: thread.id };
    },

    issues_set_repo: async ({ projectId, repo }) => {
      if (repo !== null && repo.trim() && !parseOwnerName(repo)) {
        throw new Error("Enter the repository as owner/name.");
      }
      const before = await repoFor(projectId).catch(() => null);
      await writeRepoOverride(storage, projectId, repo);
      const after = await repoFor(projectId).catch(() => null);
      // Columns, values, and thread links all belong to one repository. Pointing the
      // project elsewhere starts the board over, seeded from the new repo's labels.
      if (!sameRepo(before, after)) await clearRepoBoardState(storage, projectId);
      return null;
    },
  });

  // `bb issues …`: read-only access for agents, so a thread can look up the board's
  // issues without a GitHub MCP server or a `gh` call of its own.
  async function issuesForCli(projectId: string | undefined): Promise<{
    repo: RepoRef;
    issues: Issue[];
    values: Record<string, number>;
  }> {
    if (!projectId) {
      throw new PluginCliError("no project in scope", {
        code: "project_required",
        hint: "Run this inside a bb thread, or pass --project <project-id> (see `bb project list`).",
      });
    }
    const { repo, token } = await connect(projectId);
    const [issues, values] = await Promise.all([
      listOpenIssues(token, repo),
      readValues(storage, projectId),
    ]);
    return { repo, issues, values };
  }

  const projectOption = {
    type: "string",
    description: "Project id; defaults to the current thread's project",
    aliases: ["project-id"],
  } as const;
  const jsonOption = { type: "boolean", description: "Emit machine-readable JSON" } as const;

  bb.cli.register(
    defineCli({
      name: "issues",
      summary: "Read the open GitHub issues on a project's Issues board",
      commands: {
        list: cliCommand({
          summary: `List open issues with their labels and board value (at most ${CLI_LIST_LIMIT})`,
          options: {
            project: projectOption,
            label: {
              type: "string",
              description: "Only issues carrying this label",
            },
            json: jsonOption,
          },
          async run({ options }, ctx) {
            const { repo, issues, values } = await issuesForCli(options.project ?? ctx.projectId);
            const label = options.label;
            const matching = label
              ? issues.filter((issue) => issue.labels.some((l) => l.name === label))
              : issues;
            const shown = matching.slice(0, CLI_LIST_LIMIT).map((issue) => ({
              number: issue.number,
              title: issue.title,
              labels: issue.labels.map((l) => l.name),
              value: values[String(issue.number)] ?? null,
              url: issue.html_url,
            }));
            if (options.json) {
              return {
                exitCode: 0,
                stdout: JSON.stringify({
                  repo: `${repo.owner}/${repo.name}`,
                  total: matching.length,
                  issues: shown,
                }),
              };
            }
            if (shown.length === 0) {
              return { exitCode: 0, stdout: "No open issues." };
            }
            const lines = shown.map((issue) => {
              const labels = issue.labels.length ? ` [${issue.labels.join(", ")}]` : "";
              const value = issue.value === null ? "" : ` (value ${issue.value})`;
              return `#${issue.number}${labels} ${issue.title}${value}`;
            });
            if (matching.length > shown.length) {
              lines.push(`… ${matching.length - shown.length} more. Narrow with --label.`);
            }
            return { exitCode: 0, stdout: lines.join("\n") };
          },
        }),
        show: cliCommand({
          summary: "Show one open issue's labels, value, and body",
          positionals: [{ name: "number", description: "Issue number", required: true }],
          options: { project: projectOption, json: jsonOption },
          async run({ options, positionals }, ctx) {
            const number = Number(positionals.number.replace(/^#/, ""));
            if (!Number.isInteger(number) || number < 1) {
              throw new PluginCliError(`not an issue number: ${positionals.number}`, {
                code: "invalid_issue_number",
              });
            }
            const { repo, issues, values } = await issuesForCli(options.project ?? ctx.projectId);
            const issue = issues.find((candidate) => candidate.number === number);
            if (!issue) {
              throw new PluginCliError(`#${number} is not an open issue in ${repo.owner}/${repo.name}`, {
                code: "issue_not_found",
                hint: "Run `bb issues list` to see open issues.",
              });
            }
            const slug = `${repo.owner}/${repo.name}`;
            const detail = {
              number: issue.number,
              title: issue.title,
              labels: issue.labels.map((l) => l.name),
              value: values[String(issue.number)] ?? null,
              url: issueUrl(slug, issue.number),
              body: issue.body ?? "",
            };
            if (options.json) return { exitCode: 0, stdout: JSON.stringify(detail) };
            const lines = [
              `#${detail.number} ${detail.title}`,
              detail.url,
              `Labels: ${detail.labels.length ? detail.labels.join(", ") : "none"}`,
              `Value: ${detail.value ?? "none"}`,
              "",
              detail.body.trim() || "(no description)",
            ];
            return { exitCode: 0, stdout: lines.join("\n") };
          },
        }),
      },
    }),
  );
}
