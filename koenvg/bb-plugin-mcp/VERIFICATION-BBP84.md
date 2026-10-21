# BBP-84 local resolution checkpoint

Task: BBP-84 under BBP-78. Worker: [thr_83gwxydepf](bbthread://thr_83gwxydepf). Coordinator: [thr_eqpxdi64pk](bbthread://thr_eqpxdi64pk).

Starting HEAD: `0115c1ccf738a8e8e654fe39461f27dc3a32829d`.
Parent baseline: `55b1bb1595269ee6960ae0153861f8d630836075`.
Earlier approved baseline: `d92a2189850a34073e291b7fbfc64bc4a8e97bfe`.
Worker branch: `bb/bbp-84-resolve-uncertain-request-outcomes-thr_83gwxydepf`.
The clean starting HEAD matched the approved BBP-83 branch tip. The coordinator verified the parent and BBP-84 attachment and sent `BEGIN BBP-84` before implementation or checks. BBP-81 was done.

## Scope and public contracts

Adds only local `bb mcp operations` and `bb mcp resolve-operation`, using the existing plugin SQLite ledger. The append-only migration adds one nullable resolution timestamp. No new dependency, setting, remote tool or approval path exists. `bb mcp status`, MCP names and schemas, submitting identity, result fields, send/stop behavior and the shared absolute response deadline stay unchanged.

SDK 0.6.15 exposes the local CLI registration/result, `storage.database()` and append-only `storage.migrate()` contracts. Resolution uses a synchronous immediate transaction. It checks the tracked active-operation map and persisted unknown state inside that transaction, validates the selected result and original target, and saves the owner observation. It never calls BB, even to inspect the target. The owner must do that check manually. Current remote owner/project/thread checks remain in the existing read/replay path.

Diagnostics contain selected identity, target, state and timestamp fields only. They use pages of at most 50 records and a 64 KiB output bound with continuation. They omit prompts, messages, output, tokens, raw BB errors and input hashes. Resolved outcomes use fixed owner-verification codes. Manual failure means verified non-acceptance, not an unsupported claim that no dispatch occurred. Unknown remains protected until verified resolution; completed records retain their keys for at least 24 hours from the outcome update.

## Automated evidence

- Red/green checkpoints verified that the diagnostic command and verified resolution test failed before their implementation and passed afterward.
- All 275 package tests pass in 12 files, including 42 new local CLI and authenticated HTTP/MCP tests.
- `npm run typecheck`, `npm run build`, and `bb plugin types --check` pass. SDK pin and host are 0.6.15. The standalone build produced only ignored `dist` artifacts; it did not install or reload the live plugin.
- Root `npm run check` passes with existing unrelated lint warnings. `git diff --check` passes.
- `openspec validate bb-chatgpt-mcp --strict` passes. README/skill local-link and heading checks, skill frontmatter and command/recovery checks pass.
- Locked root and package dependency installation succeeded. The full audit still reports nine development build-tool entries, one critical, seven high and one moderate. Production-only audit reports zero. Existing BBP-173 records this exact dependency maintenance cost; it was inspected and reused without dispatch or dependency changes. BBP-175 remains separate and untouched.

Test evidence covers acceptance for start, send sent/queued and stop; verified failure for all three tools; invalid input and missing verification; inconsistent project/thread/delivery; final-record refusal; concurrent resolution; active pending and timed-out races with a late reply; generation restart persistence; unchanged keys and hashes through identical retries and conflicts; indefinite unknown retention and the inclusive 24-hour resolved-key boundary; owner/issuer/project/remote access loss and moved/deleted/missing threads; read-only status with control disabled; bounded multibyte diagnostics; and zero BB calls from local resolution.

The public SDK fake host uses real better-sqlite3 storage in a temporary directory and reopens persisted data across its reload driver. Integration uses a real loopback HTTP listener, synthetic signed JWT issuer, MCP protocol calls and synthetic SDK effects. Restart evidence is at that fixture boundary, not a live BB process restart. No test resolves real operator records or starts real agent work.

Logs: `/Users/koen/.bb/thread-storage/thr_83gwxydepf/bbp84/` contains `tests.log`, `typecheck.log`, `build.log`, `sdk.log`, and `repository.log`.

## Safe fixture-only steps

From this checkout:

```sh
cd bb-plugin-mcp
npm ci
npm test -- tests/operations-local.test.ts tests/resolution.test.ts
npm test
npm run typecheck
npm run build
bb plugin types --check
cd ..
npm ci
npm run check
openspec validate bb-chatgpt-mcp --strict
```

These commands use local fixture data and build artifacts. Do not run the README's resolution examples against installed operator records during this checkpoint. Do not install, reload a live plugin, enable remote/control settings or invoke real MCP tools. Any live action needs separate approval for its exact records and side effects.

## Review and release limits

The single fresh-context completion review approved the fixture checkpoint with no blocking findings and no new cleanup finding. The reviewer independently reran all 275 tests, the 42 focused tests, typecheck and the fixed-point diff check. Its first targeted command ran at the repository root, which has no test script; the corrected package command passed. No source fixes or second review were needed. The review artifact is `/Users/koen/.bb/thread-storage/thr_83gwxydepf/bbp84/BBP84-COMPLETION-REVIEW.md`. Delivery attaches it to BBP-84 and pauses `in_review` for owner feedback, not `done`.

Live local CLI hosting, real BB restart, OAuth account registration/login/refresh, public tunnel reachability, deployment and ChatGPT web/native mobile acceptance remain unverified. No installation, real-project MCP read, cost test or infrastructure change ran. Main and the coordinator checkout were not changed. BBP-85 was not dispatched and BBP-78 remains open.

Native `tasks_report` is unregistered in this Pi session. Task evidence uses an ordinary Tasks comment and attachments, not a durable native report. No CLI-origin or report-context bypass is used.
