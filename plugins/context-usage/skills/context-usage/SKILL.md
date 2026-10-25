---
name: context-usage
description: Explains the context percent in a BB thread header and the bb context-usage command. Use when the user asks how full a thread's context window is, or why the composer ring and the header percent disagree.
---

# Context usage

The Context Usage plugin shows one whole percent in the thread header. Point at the percent. A card opens with the token counts. The header is a window drag region, so a browser tooltip does not open there.

## Where the number comes from

- **Grok threads.** The percent is the live context window from that thread's newest `signals.json` under `~/.grok/sessions` (or `$GROK_HOME/sessions`). Grok's ACP usage report is the session input total. That total can pass the window size, so the plugin does not use it for the percent.
- **Other providers.** The percent is BB's recorded context window (`bb thread context`). A count larger than the window is left blank.

The header refreshes about every 5 seconds while the thread is open. A thread with no recorded window shows no percent.

## Command

```sh
bb context-usage show [thread-id] [--json]
```

Omit the thread id inside a thread. `--json` prints the usage object, or `null`.
