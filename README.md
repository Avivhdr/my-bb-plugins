# my-bb-plugins

bb plugins. My own live under `plugins/`. The ones copied from [koenvg/bb-plugins](https://github.com/koenvg/bb-plugins) live under `koenvg/`, in Koen's layout. See [koenvg/UPSTREAM.md](koenvg/UPSTREAM.md) for the source commit, local changes and how to sync.

| Plugin | What it does |
| --- | --- |
| [issues](plugins/issues) | A per-project Kanban board over GitHub Issues |
| [claude-usage](plugins/claude-usage) | Claude Code API cost per project and thread, priced from local transcripts. Copied from koenvangeert/bb-plugins-collibra at 0b281ca |
| [pinned-prompt](plugins/pinned-prompt) | Keeps your last message pinned at the top of the chat while you read a long reply |
| [thread-name](plugins/thread-name) | A Name field in the new-thread composer, so threads start with your name instead of the prompt |
| [harbor-theme](plugins/harbor-theme) | The default bb palette with a soft blue gradient on the window frame |
| [browser-annotate](koenvg/bb-plugin-browser-annotate) | Mark areas in a Browser tab and send them to the agent as cropped screenshots with comments |
| [changes](koenvg/bb-plugin-changes) | A Changes tab with the thread's diff and inline review comments |
| [code-cleanup](koenvg/bb-plugin-code-cleanup) | Per-project guidance that asks agents to record cleanup as separate tasks |
| [compose-chat](koenvg/bb-plugin-compose-chat) | A Compose-style restyle of the chat |
| [github-insight](koenvg/bb-plugin-github-insight) | A PR tab with blockers, reviewers, checks, conversation and diff, plus a review queue panel |
| [markdown-reader](koenvg/bb-plugin-markdown-reader) | A read-only Markdown reader |
| [mcp](koenvg/bb-plugin-mcp) | Remote MCP access to projects and threads, off until configured |
| [pr-thread-list](koenvg/bb-plugin-pr-thread-list) | Sidebar thread list with Needs attention / In flight / All tabs, PR badges and snooze |

Install one from a checkout:

```sh
bb plugin install ./plugins/issues
```

Or from git once this repository is pushed:

```sh
bb plugin install git:<repo-url>@main --plugin issues
```
