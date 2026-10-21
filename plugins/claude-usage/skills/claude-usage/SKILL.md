---
name: claude-usage
description: Explains the Claude Usage plugin's spend figures, its rescanMinutes setting, and how to add a model price. Use when the user asks why a thread shows no spend, why spend shows as "Outside BB", why a model is excluded, or how to change the rescan interval.
---

# Claude Usage

The plugin prices Claude Code transcripts from `~/.claude/projects` on the BB server. It shows the result on the `Claude usage` sidebar page and in each thread header.

## Setting

| Command | Effect |
| --- | --- |
| `bb plugin config claude-usage set rescanMinutes <1-240>` | Wait between transcript scans. Default 5. Applies after the current wait. |

## Why a figure looks wrong

- **Thread shows "No spend recorded".** The thread shares its directory with other threads or runs in the project checkout. That spend counts for the project only.
- **Spend under "Outside BB".** The working directory matches no project source, no environment, and no `worktrees/thr_<id>-<n>/` folder of a known thread. Threads on remote hosts also land here.
- **Model named in the banner.** `PRICE_TABLE` in `src/pricing.ts` has no entry for it. Add one with the model's USD rates per million tokens for input, output, 5-minute cache write, 1-hour cache write, and cache read. Match the exact model id; do not reuse a family entry. Then rebuild and reload the plugin.
- **Total lower than the bill.** Transcripts leave out some billed usage, so every figure is a lower bound.
