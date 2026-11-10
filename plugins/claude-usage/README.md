# Claude Usage

Prices the Claude Code transcripts on the BB server host and shows what they cost. Ported from the OpenForge `claude-usage` plugin.

## What it adds

- A `Claude usage` page in the sidebar. It shows spend today, over 7 days, over 30 days, and over all indexed history. It also has a 30-day daily chart split by cost component, spend per project, the top 15 threads, and spend per model.
- Today's spend on that sidebar row.
- The spend of the open thread in the thread header.
- A banner that names any model the price table has no rate for.
- A warning above a thread's composer when its next message will be expensive, with a button to compact the thread. See "Live session warnings".
- Dashboard panels for the last 30 days: where the money went (with re-caching after a pause split out), cost per call by context size, and the most expensive sessions with their peak context, re-caching cost and PRs. A live table shows what the next message costs in the 10 most recent sessions.

## Live session warnings

Every call re-sends the whole conversation. While the prompt cache is warm the call reads it at a tenth of the input rate. After 5 minutes without a call (an hour for sessions on the one-hour cache) the cache is gone, and the next call writes the whole context again at 1.25 times the input rate. On a 600K-token Opus conversation that is about $3 before any work happens.

The plugin reads the end of every transcript written in the last 30 days, at most every 10 seconds, and prices the next call both ways. Every thread with a session shows that price as one line above its composer. `src/advice.ts` raises it to one of three warnings:

- Cold: the cache expired and re-caching costs $1 or more. Red banner.
- Expiring: under 2 minutes of cache left on a re-cache of $1 or more.
- Large: the context is 300K tokens or more.

A thread that is mid-turn is never called cold, since nobody can reply to save the cache. Warnings only reach threads Claude Code runs alone in their environment, the same rule as thread attribution.

The scanner tags a call as re-caching when it comes more than 5 minutes after the previous call and writes at least half its context to the cache. Those tags, and calls per context size, live in `facet_rows`. Session titles, peak context and PR links live in `sessions`. A transcript indexed before these tables existed is re-read once if it is still on disk.

## How the numbers are produced

Claude Code writes one JSONL transcript per session under `~/.claude/projects/<encoded-cwd>/`, plus `<session>/subagents/*.jsonl` for subagents. A background service reads both. It re-reads a file only when its size or mtime changed.

Three details decide whether the total is right:

- Claude Code writes one record per content block, and each repeats the response's usage. The scanner keeps one record per `message.id`. Counting records doubles the total.
- The last record for a `message.id` wins. Earlier records of a streamed response carry a partial `output_tokens`.
- Subagent transcripts count. Skipping them loses a double-digit percentage.

Prices live in `PRICE_TABLE` in `src/pricing.ts`, in USD per million tokens. A model id matches its entry exactly after the scanner strips a `[1m]` suffix and a `-YYYYMMDD` date. A prefix match would price `claude-opus-5-5` as `claude-opus-5`. A model with no entry is left out of every figure and named in the banner. Add the entry when Anthropic ships a model or changes a price.

Every figure is a lower bound. The price table reproduces Claude Code's own `cost-state` totals exactly, but the transcripts leave out some billed usage, mostly a few percent of cache reads.

## Storage

The plugin keeps its index in its own SQLite database. Claude Code prunes transcripts after about a month, so the index is the only record of older periods:

- Rows hold token counts per transcript, UTC hour, model, and working directory. Dollars come from the price table on every read, so a corrected rate re-prices all history.
- Re-reading a transcript replaces that transcript's rows only.
- Rows of a deleted transcript stay forever. **Rescan transcripts** merges and never rebuilds.

## Attribution

Spend belongs to a project when its working directory is inside one of the project's source paths or inside one of its environments. The longest matching path wins. Spend that matches nothing shows as "Outside BB".

Spend belongs to a thread only when one Claude Code thread is alone in its environment. In practice that means worktree threads. Threads that share a directory count for their project only, because the transcript cannot say which thread spent the money.

BB clears an environment's path when it destroys the environment. The plugin stores every path it sees, so it keeps attributing after cleanup. For worktrees destroyed before install, it reads the thread id from the folder name (`worktrees/thr_<id>-<n>/`).

Limits:

- Threads on remote hosts write transcripts on that host. The plugin reads only the BB server host.
- If BB renames its worktree folders, the folder-name fallback stops matching. Spend then shows as "Outside BB", never under a wrong thread.

## Setting

`rescanMinutes` (1 to 240, default 5) sets the wait between scans. The service reads it before each wait, so a change applies after the current wait without a reload.

```bash
bb plugin config claude-usage set rescanMinutes 30
```

Set `CLAUDE_CONFIG_DIR` on the BB server to read a relocated Claude Code install.

## Development

```bash
bun install
bun run test && bun run typecheck
bb plugin build
```

Tests use Node's built-in `node:sqlite`, so they run without building the `better-sqlite3` native module.
