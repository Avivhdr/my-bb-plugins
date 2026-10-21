# my-bb-plugins

bb plugins, one directory each under `plugins/`.

| Plugin | What it does |
| --- | --- |
| [issues](plugins/issues) | A per-project Kanban board over GitHub Issues |
| [claude-usage](plugins/claude-usage) | Claude Code API cost per project and thread, priced from local transcripts. Copied from koenvangeert/bb-plugins-collibra at 0b281ca |
| [pinned-prompt](plugins/pinned-prompt) | Keeps your last message pinned at the top of the chat while you read a long reply |
| [harbor-theme](plugins/harbor-theme) | The default bb palette with a soft blue gradient on the window frame |

Install one from a checkout:

```sh
bb plugin install ./plugins/issues
```

Or from git once this repository is pushed:

```sh
bb plugin install git:<repo-url>@main --plugin issues
```
