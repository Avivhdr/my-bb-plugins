# BBP-80 corrected thread-read checkpoint

Correction baseline: `7f554fd8759b12136b9a9201a05f4bab15885099`.
Complete BBP-80 implementation baseline: `82c6e6f4569b2b2535eb908ed3eabac04afcf198`.
Earlier parent baseline: `0e9e298afa7d6717cb23bc937845384817b53bde`.
Branch: `bb/bbp-80-read-thread-status-and-output-thr_hc8asbz6gj`.
Task: BBP-80 under BBP-78. Worker: `bbthread://thr_hc8asbz6gj`. Coordinator: `bbthread://thr_eqpxdi64pk`.
The corrected commit and fresh completion-review evidence are recorded in a new BBP-80 report. The previous checkpoint's approval does not cover this correction.

## Bounded correction

The catalog, `ThreadTool` type, failure logs, tests, README example and package skill now use the planned name `bb_get_thread`. The contract is recorded in [the design tool table](../openspec/changes/archive/2026-10-15-bb-chatgpt-mcp/design.md) and [task 3.2](../openspec/changes/archive/2026-10-15-bb-chatgpt-mcp/tasks.md). No alias is registered. Discovery tests require the exact three-tool catalog and verify that the earlier name is rejected without an SDK call.

This correction changes only the public tool name and its references. Schemas, selected output fields, access checks, pagination, UTF-8 limits, pending-interaction behavior and transport limits are unchanged. No settings, dependency manifests, lockfiles, historical specifications, task descriptions, comments or attachments are changed.

## Local verification

- Before the implementation rename, the updated protocol tests failed, 17 failed and 25 passed. After the rename, all 59 package tests across four files passed.
- Package typecheck, standalone build and SDK compatibility passed on the existing BB 0.45 / SDK 0.6.15 dependency baseline. Package tests include the public-SDK-only scan.
- Repository lint, formatting and Git whitespace checks passed. Existing warnings outside this package remain.
- The package skill validator passed through an isolated `uv --with pyyaml` environment.
- A fresh completion review is required for this corrected final change. No earlier code approval is reused.

## Safe local feedback steps

Use the existing locked dependencies, or first run `npm ci` at the repository root and in `bb-plugin-mcp`.

```sh
cd bb-plugin-mcp
npm test
npm run typecheck
npm run build
bb plugin types --check
cd ..
npm run check
```

These checks use generated keys and local fixtures. They do not install or enable a plugin. Read [the current tool reference and example](README.md#tool-and-request-limits). Stop at `in_review` for owner feedback.

## Remaining limits

No installation, remote enablement, real-project MCP reads, live OAuth/PKCE/refresh, tunnel or infrastructure changes, live agent control, ChatGPT web or native mobile checks were run. Hosted CI, other plugin suites and unchanged ingress checks were not rerun. Clean dependency installation was verified at the preceding checkpoint, not repeated for this name-only correction.

Status, output and interactions remain separate observations, not one atomic snapshot. Free-text assistant output can contain private information. Hidden direct reads remain permitted within an allowed project. The SDK supplies full assistant text before the 8 KiB transmission limit. Heavy escaping or large titles can fail safely. Existing build advisories remain tracked in BBP-173. Control tools, remote approvals and the operation ledger are out of scope.
