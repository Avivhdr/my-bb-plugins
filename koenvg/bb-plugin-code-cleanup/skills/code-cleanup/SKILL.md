---
name: code-cleanup
description: Manage Code Cleanup's saved default, project enablement choices, and custom guidance through the BB CLI.
disable-model-invocation: true
---

# Code Cleanup commands

This is a command reference, not the cleanup policy given to agents. The package sets `bb.skills: []`, so BB does not auto-import it. See the package README for install and lifecycle limits.

Use a standard project ID from `bb project list` and specify it on every command:

```sh
bb code-cleanup enable --project proj_ID
bb code-cleanup disable --project proj_ID
bb code-cleanup show --project proj_ID
bb code-cleanup enablement reset --project proj_ID
bb code-cleanup prompt set --project proj_ID --text "Project-specific instructions"
bb code-cleanup prompt reset --project proj_ID
```

`show` reports effective enabled/disabled, custom/default prompt source, and the enablement source. `enable` and `disable` save explicit choices that take precedence over the default. Disable keeps custom text. `enablement reset` clears only that choice and keeps the prompt. Projects without a choice follow the saved default, including new projects and projects with new prompt-only rows.

The default starts false on install and upgrade. Change it through the host setting:

```sh
bb plugin config code-cleanup set enableByDefault true
bb plugin config code-cleanup set enableByDefault false
```

Default changes affect fresh eligible sessions without reload. Explicit choices stay unchanged. Existing provider sessions keep their earlier guidance.

`prompt set` replaces the factory source and rejects blank text or more than 4,096 characters. Pass exact multiline source as one `--text` argument, with safe quoting or an argument-array process API. There is no supported `--text-stdin` flag. `prompt reset` changes only text and restores guidance that asks agents to record substantial cleanup through BB Tasks. Saving or resetting a prompt does not pin inherited enablement.

Upgrade keeps every legacy enabled or disabled choice explicit, including prompt-only disabled rows, and preserves custom source exactly. Use the README's backup and rollback steps before live upgrade. Task recording requires an available CLI and one tracker linked to the current BB project; the plugin never creates tasks itself.
