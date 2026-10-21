# BBP-81 safe-start checkpoint

Task: BBP-81 under BBP-78. Worker: [thr_v7g2xacj9b](bbthread://thr_v7g2xacj9b). Coordinator: [thr_eqpxdi64pk](bbthread://thr_eqpxdi64pk).

Starting baseline: `c6af0bed81cbdfed7ab7b6dd8ad2dacbf53840a5`.
Baseline parent: `7f554fd8759b12136b9a9201a05f4bab15885099`.
BBP-80 implementation baseline: `82c6e6f4569b2b2535eb908ed3eabac04afcf198`.
Earlier baseline: `0e9e298afa7d6717cb23bc937845384817b53bde`.
Worker branch: `bb/bbp-81-start-threads-without-duplicate-work-thr_v7g2xacj9b`, based on the approved BBP-80 branch. HEAD and its parent matched before edits. The coordinator verified parent and task attachment and sent `BEGIN BBP-81` before implementation.

## Scope

Adds only `bb_start_thread`, `bb_get_operation`, durable SQLite identity and submission tracking. Existing read tools and their schemas remain intact. No send, stop, local resolution, task-board mutation, permission response or execution override is added. No main/coordinator checkout changes were made.

Start uses the public project-default execution read, selected server-owned settings, visible `threads.spawn`, and operation metadata. Write authorization checks both scopes, current owner/token expiry, local control and allowed project again before dispatch. Results identify submission acceptance, not agent completion.

The ledger commits the owner/tool/key and normalized-input hash before dispatch. Completed results remain protected for at least 24 hours. Unresolved records never expire or replay. Capacity exhaustion refuses new claims. The documentation describes key expiry, unknown outcomes and BB inspection. Any error after invoking spawn is conservatively unknown because the public SDK has no transactional creation-error guarantee.

## Verified local evidence

- Clean locked dependency setup passed with `npm ci` at root and in the package on Node 24.15.0. No dependencies or lockfiles changed. npm reported nine existing package dependency audit findings; no audit fix was applied.
- Test-first start failed before tool registration, then passed. The complete suite passed: 104 tests across six files, including the public-SDK-only scan.
- Package `npm run typecheck`, `npm run build`, and `bb plugin types --check` passed against BB 0.45.0 and SDK 0.6.15.
- Repository `npm run check` and `git diff --check` passed. Existing lint warnings outside MCP remain.
- Single fresh-context completion review passed, run `7f50cce9-a90b-4678-be64-2dbfbac0bb11`. The reviewer found no blockers or actionable cleanup. The reviewer independently reran all 104 tests, typecheck and Git whitespace checks. Build, SDK compatibility and root checks were worker-verified, not reviewer-rerun. Full review evidence is attached to BBP-81.

## Safety evidence

Tests use signed fixture JWTs, a real local HTTP issuer/listener, official MCP client/protocol calls, real plugin SQLite storage and synthetic public SDK effects. No test starts a real BB thread.

- Six concurrent identical calls dispatch once and share an operation ID. Changed prompts and titles conflict. Normalized IDs/titles replay; prompt whitespace stays significant.
- Status polling and lost-reply replay do not dispatch. Project removal, owner changes, thread move/deletion, scope denial and expiry deny data/actions. Access removal during defaults blocks dispatch; removal during membership reads blocks cached replies.
- Missing/default-read failures are confirmed pre-dispatch failures with no fallback. BB rejection or lost SDK reply stays unknown, not safe to retry.
- A pending start returns without waiting for agent completion. SDK deadline yields unknown; a later result in the same generation can establish acceptance. Client disconnect before dispatch prevents it; disconnect afterward leaves outcome tracking active and does not stop an agent.
- Graceful reload and simulated abrupt generation loss retain unknown identities without dispatching again. A late defaults reply cannot dispatch from the old generation. This test exposed and fixed the need for a durable generation/state check immediately before spawn.
- Completed keys remain protected at exactly 24 hours. Unresolved keys remain protected after one year and restart. Ledger capacity refuses new mutations. Eight unresolved submissions hold their slots; the ninth is refused. Membership checks remain bounded even if a synthetic SDK ignores cancellation.
- Exact SDK argument checks prove visible project-default creation with only server-owned defaults and metadata. No Tasks Plus, send, stop, hook bypass or permission-response calls occur. Live BB hook/permission behavior is not claimed as verified by a fixture.

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

These commands install local development dependencies and build artifacts only. They do not install or enable the plugin, connect a live OAuth account, expose a public endpoint, read real projects through MCP, or create an agent. Read [the start/operation rules](README.md#thread-starts-and-operation-status).

## Unrun checks and decisions

No plugin installation/reload in the real BB runtime, remote enablement, real-project MCP reads, live OAuth/PKCE/refresh, tunnel changes, live agent actions/provider costs, ChatGPT web/native mobile checks, hosted CI or unrelated plugin suites ran. Those need separate approval or later slices. Native operation resolution remains BBP-84 scope; unknown records stay protected until then.

Pause at `in_review`, not `done`, for owner feedback. Decide whether this fixture-only safe-start checkpoint can continue to the next approved slice. This checkpoint does not authorize deployment or live agent costs.

Native `tasks_report` is not registered in this Pi installation. The outcome uses an ordinary Tasks comment and attachments; it is not a durable native report, and no CLI origin/report-context override is used.
