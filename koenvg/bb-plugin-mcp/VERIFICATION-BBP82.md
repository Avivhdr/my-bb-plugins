# BBP-82 follow-up checkpoint

Task: BBP-82 under BBP-78. Worker: [thr_kkrkhnamna](bbthread://thr_kkrkhnamna). Coordinator: [thr_eqpxdi64pk](bbthread://thr_eqpxdi64pk).

Starting HEAD: `d92a2189850a34073e291b7fbfc64bc4a8e97bfe`.
Parent baseline: `c6af0bed81cbdfed7ab7b6dd8ad2dacbf53840a5`.
Earlier baselines: `7f554fd8759b12136b9a9201a05f4bab15885099`, `82c6e6f4569b2b2535eb908ed3eabac04afcf198`, `0e9e298afa7d6717cb23bc937845384817b53bde`.
Worker branch: `bb/bbp-82-send-follow-up-instructions-thr_kkrkhnamna`. The clean starting HEAD matched the approved BBP-81 checkpoint. The coordinator verified parent and task attachment and sent `BEGIN BBP-82` before implementation.

## Scope

Adds only `bb_send_message` and its extension to existing operation tracking. Read/start/operation names and existing start responses stay unchanged. No stop, aliases, local operation resolution, remote approvals, task mutation, execution-setting override, shell/file/SDK forwarding, installation or remote enablement was added. Main and coordinator checkouts were not changed.

The public SDK receives only `threadId`, text input and `mode: "auto"`. BB retains its ordinary idle/active behavior and existing dispatch controls. The result records `sent` versus `queued` and a selected queue wait kind without returning private queue text, host names or rule reasons. Accepted and queued input is not completed work. All send errors after invocation remain unknown because the SDK does not promise pre-submission rejection.

The existing ledger claims issuer/owner/tool/key identity before dispatch. Send input hashes preserve message whitespace and normalize the thread ID. A second migration adds only delivery and wait-kind columns. It stores no second raw message. Saved results require current owner, scopes, local control for writes, project allowlist and thread membership. Unknown identities stay protected across reload and crash without replay.

## Verified local evidence

- Locked dependency setup passed at root and package on Node 24.15.0. No dependencies or lockfiles changed. npm reported nine existing package audit findings. No audit fix was applied.
- The idle-send test failed before tool registration, then passed. All 175 tests across eight files pass, including the public-SDK-only scan and an old BBP-81 ledger upgrade with accepted/unresolved starts.
- Package typecheck, build and `bb plugin types --check` pass against BB 0.45.0 and SDK 0.6.15. Repository `npm run check` and Git whitespace checks pass. Existing lint warnings outside MCP remain.
- The package skill validates with the skill-creator script through `uv run --with pyyaml`. This uses an isolated validation-tool environment, not a project dependency change.
- Single fresh-context review `9624f296-f439-4985-985b-b4747dde4b1a` returned one P2 response-budget finding. The worker fixed it with a shared absolute response deadline and a production-limit regression. That test first reproduced HTTP 504, then passed with a pending operation before four seconds. The independent report is attached to BBP-82. No second review ran.
- The reviewer independently reran the original 174 tests, typecheck, SDK compatibility, root checks and Git whitespace checks. The final 175-test run and post-fix build/checks are worker-verified, not reviewer-rerun. No separate actionable cleanup finding was identified.

## Safety evidence

Tests use signed fixture JWTs, real loopback HTTP issuer/listener, authenticated MCP calls and official client discovery, real plugin SQLite storage and synthetic public SDK effects only. No test sends a message to a real BB thread.

- Idle and active sent input, active queues, hook-style deferment, permission waits, offline hosts, provisioning and time waits preserve BB auto dispatch. No stop, approval, fallback or execution override is called.
- Six concurrent duplicates share one identity and one SDK send. Changed message/target conflicts. Start/send keys have separate tool identities. A full 32 KiB UTF-8 message passes; blank, oversized and privileged/extra fields fail before SDK reads.
- Missing scopes, disabled control/remote access, changed owner and removed projects deny actions. Direct IDs outside access, missing/deleted/projectless targets, membership changes and token expiry cannot bypass checks. Cached reads recheck current access after awaited membership reads.
- Pending sends, deadlines, SDK errors, client disconnect before/after dispatch, accepted lost replies, reload and simulated crash preserve inspectable outcomes without replay. A late result can establish acceptance only in its owning generation.
- Completed keys remain protected for 24 hours. Unresolved send keys stay protected after one year and restart; ledger capacity refuses new actions. Existing shared submission/read bounds and start behavior remain covered.

## Safe fixture-only feedback

```sh
npm ci
npm ci --prefix bb-plugin-mcp
cd bb-plugin-mcp
npm test
npm run typecheck
npm run build
bb plugin types --check
cd ..
npm run check
```

These steps install development dependencies and build artifacts only. Read [the follow-up rules](README.md#follow-up-instructions) for parameters, key reuse and queued/unknown meanings. The example MCP workflow describes usage after separate control approval; it is not permission to run live actions.

## Limits and next decision

No real installation/reload, real-project MCP read, live send/start/stop, provider-cost action, OAuth login/PKCE/refresh, tunnel/infrastructure change, ChatGPT web/native mobile acceptance, hosted CI or unrelated plugin suite ran. The fixtures establish protocol behavior, not live BB hook behavior or ChatGPT client support. Live actions remain unapproved. Stop is BBP-83 scope; local resolution is BBP-84 scope.

The review finding is resolved. This tested/reviewed implementation checkpoint pauses at `in_review`, not `done`, for owner feedback. Preserve task/thread links and notify only the coordinator. Do not start successors or close BBP-78.

Native `tasks_report` is not registered in this Pi installation. Delivery uses an ordinary Tasks comment and attachments, not a durable native report. No CLI origin/report-context override is used.
