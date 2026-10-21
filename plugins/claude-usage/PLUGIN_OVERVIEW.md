See what Claude Code has cost over the API, per project and per thread.

## What you get

- A **Claude usage** page in the sidebar with spend today, over 7 days, over 30 days, and all time. It has a daily chart and breakdowns by project, thread, and model.
- Today's total on the sidebar row.
- Each thread's spend in its header.

## How it works

The plugin reads the Claude Code transcripts in `~/.claude/projects` on the BB server and prices them at Anthropic list rates. It keeps token counts in its own database, so history survives after Claude Code prunes old transcripts. Nothing leaves the machine.

Figures are a lower bound, because transcripts leave out a few percent of billed usage. A model without a known price is left out and named in a banner.
