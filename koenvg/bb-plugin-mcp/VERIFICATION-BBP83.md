# BBP-83 stop checkpoint

Task: BBP-83 under BBP-78. Worker: [thr_3ve7gr73b7](bbthread://thr_3ve7gr73b7). Coordinator: [thr_eqpxdi64pk](bbthread://thr_eqpxdi64pk).

Starting HEAD: `55b1bb1595269ee6960ae0153861f8d630836075`.
Parent baseline: `d92a2189850a34073e291b7fbfc64bc4a8e97bfe`.
Prior approved baseline: `c6af0bed81cbdfed7ab7b6dd8ad2dacbf53840a5`.
Worker branch: `bb/bbp-83-stop-thread-work-thr_3ve7gr73b7`.
The clean starting HEAD matched the approved BBP-82 fixture checkpoint. The coordinator verified parent and task attachment and sent `BEGIN BBP-83` before changes or checks.

## Scope and SDK contract

Adds only `bb_stop_thread` and its extension to the existing operation store. Reads, start, send and operation names stay unchanged. The shared absolute response deadline from BBP-82 stays in use. No aliases, deletion, permission responses, generic forwarding, local operation resolution or execution overrides were added. Main and the coordinator checkout were not changed.

The public SDK 0.6.15 declares `threads.stop` with a thread ID and optional signal, returning only `{ ok: true }`. The plugin passes only the ID. This confirms acknowledgement, not completed stopping. Stop replies retain the common operation fields and add `stopRequested` and a nullable observation of status, queue-row count and pending-interaction presence. Observation failure does not discard acknowledgement or imply an empty queue. Separate reads are not an atomic or live snapshot. Stop does not request queue deletion or permission approval.

A third migration adds only selected stop observation fields. Existing start/send records and results remain intact. The ledger still claims issuer/owner/tool/key identity before dispatch. Unknown or pending keys cannot replay. Current owner, scopes, local control and project/thread access are checked before claim, immediately before dispatch and before saved results are returned. Read-only operation inspection still works when control alone is disabled.

## Verified local evidence

- Locked dependency setup passed on Node 24.15.0. No dependency or lockfile changes. npm reported nine existing package audit findings. No audit fix was applied.
- The initial stop test failed before registration, then passed after implementation.
- All 233 tests across ten files pass, including authenticated HTTP/MCP tests, the public-SDK-only scan and old-ledger upgrades.
- Package typecheck, build and `bb plugin types --check` pass against BB 0.45.0 and SDK 0.6.15.
- The package skill validates with the skill-creator validator through `uv run --with pyyaml`.
- Repository `npm run check`, Git whitespace checks and all 15 relative documentation links pass. Existing lint warnings outside MCP remain.
- Single fresh-context review `7ce0b117-cbde-436c-91e5-dd9f8d370e9a` approved this fixture-only checkpoint with no blocking findings. No second review ran and no source fixes were needed. The report is attached to BBP-83.
- The reviewer independently reran all 233 tests, typecheck, SDK compatibility, repository checks and Git whitespace checks. Build, install, skill validation and doc-link checks are worker-verified, not reviewer-rerun.
- The nonblocking duplicate send/stop request-policy cleanup is recorded as [BBP-175](bbtask://BBP-175), blocked by BBP-83. It does not block this checkpoint. No unrelated cleanup or worker was started.

## Fixture-only safety evidence

Tests use signed fixture JWTs, real loopback HTTP issuer/listener, authenticated MCP calls, official client discovery, real temporary plugin SQLite storage and synthetic public SDK effects only. They do not stop, start or message real BB agents.

- Active and inactive states report stop acknowledgement and selected observed state without a completion claim. History reads and pending permissions remain unchanged. A remaining queue row is reported without returning its text or approval payloads.
- Missing scopes, disabled control/remote access, changed owner, expiry and removed projects deny dispatch. Direct IDs for missing, deleted, projectless, wrong-ID or disallowed targets return the same safe unavailable result. Cached replies and operation status still require current access.
- Concurrent identical calls invoke one stop. Normalized IDs replay; changed targets conflict. Start, send and stop keys have separate tool identities. Strict input rejects queue deletion, permission decisions and execution overrides.
- BB errors, SDK deadlines, pre/post-dispatch disconnects, lost accepted replies, reload and simulated crash preserve pending/unknown inspection without replay. Late replies cannot overwrite a new generation. Unavailable observations remain null while acknowledged stops remain accepted.
- Completed keys stay protected for at least 24 hours. Unresolved keys stay protected after one year. Full capacity refuses new keys. Slow membership checks keep the shared absolute response deadline. Unresponsive observation reads keep occupied read slots until their SDK promises settle.
- MCP connection close, listener close and plugin lifecycle disposal do not invoke another stop. Existing send/start and lifecycle tests still pass.

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

These steps install development dependencies and produce build artifacts only. Read [the stop rules](README.md#stop-requests) for parameters and result meanings. The usage example requires separate live-control approval and is not permission to stop a real thread.

## Limits and delivery gate

No real plugin installation/reload, real-project MCP reads, live start/send/stop, provider-cost action, OAuth login/PKCE/refresh, tunnel or infrastructure change, ChatGPT web/native mobile acceptance, hosted CI or unrelated plugin test suite ran. Fixtures prove the protocol and SDK call contract, not live BB stop completion or ChatGPT client support. Live actions remain unapproved. Local resolution remains BBP-84 scope.

The tested and reviewed implementation pauses at `in_review`, not `done`, for owner feedback. Preserve task/thread links. Report only to the coordinator; do not start successors or close BBP-78.

Native `tasks_report` is not registered in this Pi installation. Delivery uses an ordinary Tasks comment and attachments, not a durable native report. No CLI origin/report-context override is used.
