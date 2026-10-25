---
name: github-issues-board
description: Read the open GitHub issues on a bb project's Issues board with `bb issues list` and `bb issues show`. Use when asked which issues are open, what an issue says, which issues carry a label, or which have the highest board value. Do NOT use to create, edit, or close issues; the board does that in the UI.
---

# GitHub issues board

The Issues plugin keeps a Kanban board over the project's GitHub repository. Each
open issue can carry a value from 1 to 10 that the team sets on the board, where
10 matters most. The value lives in bb, not on GitHub.

## Commands

Both commands default to the current thread's project. Outside a thread, pass
`--project <project-id>` (`bb project list` shows ids).

```sh
bb issues list                 # every open issue: number, labels, title, value
bb issues list --label bug     # only issues carrying one label
bb issues list --json          # {repo, total, issues: [{number, title, labels, value, url}]}
bb issues show 42              # labels, value, URL, and the full body
bb issues show 42 --json
```

`list` prints at most 200 issues and says how many it left out. Narrow with
`--label` when that happens.

## When a thread was opened from the board

**Start** on a card opens the new thread screen for that project. The input
contains the GitHub issue URL, and the person writes the instructions. Run
`bb issues show <number>` to read the body as it stands now.

## Failures

- `no project in scope`: pass `--project <project-id>`.
- `No GitHub token found`: the user needs to run `gh auth login` on the bb
  server machine, or set a token in Settings → Plugins → Issues. Tell them;
  do not try to sign in yourself.
- `No GitHub repository found`: the project's checkout has no git remote. The
  user can name the repository on the Issues page.
