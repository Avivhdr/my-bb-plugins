# bb-plugin-issues

A per-project Kanban board over GitHub Issues, as a bb plugin. Ported from the
OpenForge `issues` plugin.

Open **Issues** in the left sidebar and pick a project. The board reads the
GitHub repository from the project's git remote.

## What it does

- **Columns from labels.** Each curated label is a column, followed by "No label /
  Other". On first open the board seeds columns from the labels open issues use.
  **Columns** reorders, adds, and removes them and recolors labels on GitHub.
- **Drag to relabel.** Dropping a card on another column swaps the old column's
  label for the new one on GitHub.
- **Collapsible columns.** The chevron on a column header folds it down to the
  header and its count. bb remembers which columns are folded, per project.
- **A value per issue.** Click the badge on a card to give it a value from 1 to
  10. Cards sort by value, then by newest. Values are stored in bb, not on
  GitHub.
- **Dependencies.** GitHub's "blocked by" and "blocking" links show as chips on
  each card, and an arrow runs from each blocking card to the card it blocks.
  Blocked cards are gray. Hovering a card highlights its arrows and the cards on
  the other end. Clicking a chip scrolls to that issue, or opens it on GitHub
  when it is in another repo or off the board.
- **Filters.** The bar under the toolbar narrows the board by linked thread (all,
  no thread, has thread), by dependency (all, blocked, blocking, unblocked), and
  by value chips. Each project keeps its filters until the bb window reloads.
- **Search.** `/` focuses the search box. It matches title, body, and `#number`,
  and shows why a card matched when the title alone doesn't.
- **Sub-issues and linked PRs.** Sub-issues nest under their parent when both
  sit in the same column. Linked pull requests show as chips.
- **Edit in place.** Click a card to edit its title, body, labels, and value, or
  close it. ←/→ page through the column. Leaving with unsaved text asks first.
- **AI-drafted issues.** **Create** turns a rough note into a structured issue
  through Anthropic or Groq. Skip AI uses the note as the title.
- **A thread per issue.** **Start** on a card, or **Start thread** in its menu
  or drawer, opens the new thread screen for that project. The input contains
  the GitHub issue link, and you write the instructions. **Draft in new
  thread…** opens the same screen with a short "implement this issue" prompt.
- **`bb issues` for agents.** `bb issues list` and `bb issues show <n>` give
  agents read-only access to the board. The bundled skill tells them how.

## Setup

GitHub access comes from the `gh` CLI on the bb server machine, so
`gh auth login` there is enough. To use a different token, set **GitHub
token** in Settings → Plugins → Issues.

Refine needs an **Anthropic API key** or a **Groq API key** in the same settings
page. With both set, **Preferred AI provider** picks one. Keys are secret
settings: bb stores them server-side and never sends them to the browser.

If a project's checkout has no git remote, the board asks for the repository as
`owner/name`.

## Development

```sh
npm install
npm test            # vitest: core logic, server on the fake host, UI with renderSlot
npm run typecheck
npm run build       # bb plugin build → dist/
bb plugin install . # register this directory with your bb
bb plugin dev       # rebuild and reload on save
```

Layout:

- `server.ts` registers settings, RPC methods, and the `bb issues` command.
- `host.ts` reads `gh auth token` on the server machine.
- `contract.ts` holds the zod schemas for both wire boundaries.
- `core/` is framework-free logic: the GitHub client, board assembly, search,
  per-project storage, and the AI prompt and transports.
- `ui/` is the React board. `app.tsx` registers the sidebar page and maps the
  route `/plugins/issues/board/<projectId>` to a project.
- `components/ui/` is vendored shadcn source from the bb registry.

## Differences from the OpenForge version

- The UI is React instead of Svelte, built on bb's vendored components.
- GitHub auth uses `gh` or a secret setting instead of OpenForge's stored token.
- API keys are bb secret settings instead of plain plugin storage, so the
  custom settings screen is gone.
- "Start Task" became "Start thread" (spawned and linked) and "Draft in new
  thread…" (composer prefilled, not linked).
- The repository override moved from OpenForge's project config to the board's
  error state.
- `bb issues list` and `bb issues show` are new.
