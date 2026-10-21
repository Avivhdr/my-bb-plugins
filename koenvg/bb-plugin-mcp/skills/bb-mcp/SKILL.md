---
name: bb-mcp
description: Inspect BB MCP readiness and operation outcomes, record owner-verified local resolution, check standard-project access, or diagnose OAuth and tunnel prerequisites.
---

# BB MCP

## Locate installed guides

Run `bb plugin list --json`. In `plugins`, select the single entry whose `id` is `mcp`. Use its absolute `rootDir` as `MCP_ROOT`, the installed package directory. `$MCP_ROOT` below denotes that resolved path, not a pre-existing environment variable.

Resolve every guide path below from `MCP_ROOT`, not this exported skill's directory or the working directory. If the command fails, the entry is missing or ambiguous, `rootDir` is not absolute, or a required guide cannot be read, stop and report the missing prerequisite. Do not guess a checkout path, use a different package copy, or continue without the instructions. This read-only lookup grants no installation or configuration approval.

## Inspect and operate

1. Run `bb mcp status --json`. Use the effective URL and listener state. Local listening does not prove public reachability.
2. For settings, OAuth, tunnel routing, or reload problems, read the package guide at `$MCP_ROOT/README.md`. Use standard BB plugin settings. A missing external issuer or existing named tunnel is a prerequisite.
   For `cloudflare-access`, first read the authorization exception at `$MCP_ROOT/README.md#cloudflare-managed-oauth-mode`. It uses a local app permission shared by all owner/app sessions, not BB OAuth scopes. Keep it read-only and control disabled unless both grants have explicit approval. Do not change modes to bypass a rejected credential.
3. Make live installation, remote enablement, OAuth login, and connector changes only with specific owner approval. Preserve BB threads, existing infrastructure and credentials.
4. Report local checks separately from public and ChatGPT checks. Record any missing setup. Use the thread-read checkpoint at `$MCP_ROOT/VERIFICATION-BBP80-CORRECTION.md` and the connection checklist at `$MCP_ROOT/VERIFICATION.md` for a release check.

Read the tool reference at `$MCP_ROOT/README.md#tool-and-request-limits` before provider discovery or thread reads and the start and operation rules at `$MCP_ROOT/README.md#thread-starts-and-operation-status` and the follow-up rules at `$MCP_ROOT/README.md#follow-up-instructions` and the stop rules at `$MCP_ROOT/README.md#stop-requests` before explicit provider selection, control, or recovery. All current and future standard projects are eligible under the global permissions without project grants. Their content can be sent to ChatGPT when remote reads are enabled. Every remote tool excludes BB's built-in Personal project, including status and cached replies. A standard project named Personal remains eligible. Legacy `projects` settings are ignored without stored-settings writes. Pending approval requests need action in BB.

After a lost start, send or stop reply, keep the original operation key and exact text. Read `bb_get_operation` if the ID is known, or repeat the original tool input and key. Accepted or queued means submission only. For unknown outcomes, inspect BB and preserve unresolved records. A fresh key is not a safe recovery test.

For local investigation, read diagnostics, verification and retention rules at `$MCP_ROOT/README.md#local-diagnostics-and-resolution`. Run `bb mcp operations --operation <operationId> --json`, or page with `--limit 1..50` and `--cursor <nextCursor>`. Summaries omit content and credentials. Old Personal records remain locally inspectable and resolvable. Do not delete them to bypass remote exclusion. With owner approval for the specific record, manually verify BB acceptance or non-acceptance before using `bb mcp resolve-operation <operationId> --outcome accepted|failed --project <projectId> [--thread <threadId>] [--delivery sent|queued] --verified --json`. Preserve the existing target. Active or final records are refused. Keep insufficient evidence unknown. Resolution only records the observation; it submits no action and answers no permission. Resolved keys stay protected for at least 24 hours. Keep the ledger during cleanup and leave the external tunnel unchanged.

Stop acknowledgement is not confirmed completion or queue deletion. Handle pending permissions in BB. Closing MCP or disabling the plugin does not stop agents.
