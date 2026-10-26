# Plugins copied from koenvg/bb-plugins

These folders are a copy of part of https://github.com/koenvg/bb-plugins. They keep Koen's layout, so the relative imports between them work unchanged: changes and github-insight share `review-ui/`, markdown-reader uses `packages/markdown-document`, and pr-thread-list imports from `bb-plugin-github-insight/`.

Last synced from upstream commit `45242ad81b81b27b1f66eefb8acbe506cb53a2b5`.

## What's here

| Folder | Plugin |
| --- | --- |
| `bb-plugin-browser-annotate` | Mark areas in a Browser tab and send them to the agent as cropped screenshots with comments |
| `bb-plugin-changes` | A Changes tab with the thread's diff and inline review comments |
| `bb-plugin-code-cleanup` | Per-project guidance that asks agents to record cleanup as separate tasks |
| `bb-plugin-compose-chat` | A Compose-style restyle of the chat |
| `bb-plugin-github-insight` | A PR tab with blockers, reviewers, checks, conversation and diff, plus a review queue panel |
| `bb-plugin-markdown-reader` | A read-only Markdown reader |
| `bb-plugin-mcp` | Remote MCP access to projects and threads (off until configured) |
| `bb-plugin-pr-thread-list` | The sidebar thread list with Needs attention / In flight / All tabs, PR badges and snooze |
| `review-ui/`, `packages/`, `scripts/` | Shared code and test helpers the plugins import |

The root `package.json`, `bun.lock`, `.bun-version`, `.oxlintrc.json` and `.oxfmtrc.json` are upstream's lint and format tooling.

## Local changes

- `bb-plugin-github-insight`: read the linked pull request from the GitHub PR Status plugin (`bb--github-pr-status` method `pullRequests`). BB 0.47.1 no longer has `sdk.environments.pullRequest`.
- `bb-plugin-pr-thread-list`: keep the server SDK out of the frontend bundle, so the plugin builds when bb installs it. Upstream PR: https://github.com/koenvg/bb-plugins/pull/339 (not merged).
- `bb-plugin-pr-thread-list`: the row menu's Rename runs bb's own rename action (`bb--core/rename`), which opens bb's rename dialog. Upstream used `window.prompt`, which throws in the desktop app.
- `bb-plugin-pr-thread-list`: thread rows are one line. A Home icon (main or master) or a GitBranch icon (any other branch) sits before the name in place of the branch line. The second line appears only for a PR badge, a plugin row status, or activity cues.
- `bb-plugin-pr-thread-list`: pinned rows have a red background, a metallic red edge that circles the row (the same effect as github-insight's Start review button) and a sheen that sweeps across it. See `pinned-row.css`.

- `bb-plugin-github-insight`: the Pull Requests panel lists review requests in layers, as in [Beacon](https://github.com/Avivhdr/beacon). Direct, Teammates, and Team come from open-only GitHub searches, with Reviewed, Merged, and Ignored below them. Teammates and Team split the team requests by whether a member of the picked GitHub team wrote the PR (`core/teams.ts`). Repos can be hidden per layer or everywhere (kv `review-filters`), single PRs can be ignored (kv `review-ignored`), and "DO NOT REVIEW" PRs are dimmed and not counted. The team PR scan is gone (`core/team-prs.ts`, `github/team-prs-query.ts`, `queue/team-prs.ts`). The changes are in `core/review-filters.ts`, `core/review-queue.ts`, `core/review-queue-view.ts`, `core/review-badge.ts`, `github/review-queue-query.ts`, `queue/review-queue-service.ts`, `queue/review-filters.ts`, `queue/ignored-prs.ts`, `ui/review-queue-list.tsx`, `components/ui/dropdown-menu.tsx`, `contract.ts`, `host.ts`, and `server.ts`. The panel's side panel is the full PR tab for any PR, through PR subject ids (`core/pr-subject.ts`, `resolveSubject` in `server.ts`), and an Activity tab lists comments, replies, and mentions from GitHub notifications (`core/activity.ts`, `core/activity-view.ts`, `queue/activity-service.ts`, `github/activity-query.ts`, `ui/activity-feed.tsx`, `ui/use-activity.ts`). A sync that touches these files needs a hand merge.

Re-apply these after a sync if upstream still lacks them.

## Set up a checkout

```sh
cd koenvg && bun install --frozen-lockfile
(cd packages/markdown-document && bun install --frozen-lockfile)
for p in bb-plugin-*; do (cd "$p" && bun install --frozen-lockfile); done
```

Then `bb plugin install $PWD/bb-plugin-<name>` for each plugin.

## Sync with upstream

1. Clone upstream and diff it against the recorded commit to see what changed in these folders:
   `git -C <clone> diff 45242ad81b81b27b1f66eefb8acbe506cb53a2b5 origin/main --stat -- bb-plugin-browser-annotate bb-plugin-changes bb-plugin-code-cleanup bb-plugin-compose-chat bb-plugin-github-insight bb-plugin-markdown-reader bb-plugin-mcp bb-plugin-pr-thread-list review-ui packages scripts`
2. Copy the new versions over these folders, keep the local changes above, then rebuild and reload each plugin that changed.
3. Update the commit recorded here.
