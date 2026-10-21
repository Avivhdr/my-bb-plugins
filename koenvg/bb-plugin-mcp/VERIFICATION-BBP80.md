# BBP-80 thread-read checkpoint

Implementation baseline: `82c6e6f4569b2b2535eb908ed3eabac04afcf198`, the owner-approved BBP-79 checkpoint.
Parent baseline: `0e9e298afa7d6717cb23bc937845384817b53bde`.
Branch: `bb/bbp-80-read-thread-status-and-output-thr_hc8asbz6gj`.
Task: BBP-80 under BBP-78. Worker: `bbthread://thr_hc8asbz6gj`. Coordinator: `bbthread://thr_eqpxdi64pk`.
The exact final commit and single completion-review result are recorded on BBP-80 with attached evidence. This file does not approve installation or live reads.

## Verified locally

- Clean root and package `npm ci` passed on Node 24.15.0. No dependency or lockfile changes.
- Package tests passed, 59 tests across four files. The initial 15 thread tests failed because the tools did not exist, before implementation.
- Tests use the official MCP client and real loopback HTTP listeners with synthetic BB SDK fixtures and generated issuer keys. They do not read real projects or start BB work.
- Thread tests cover read-only discovery, strict inputs, 50/15-record pagination, smaller pages, end-of-list continuation, default hidden-worker exclusion, and selected-field output.
- Thread reads check project membership before output and again after content reads. Tests cover missing, mismatched, deleted, cross-project and moved direct IDs; those failures return the same unavailable result.
- Tests cover existing-credential denial after project removal and owner changes, plus project and owner changes during reads.
- Tests cover current status, null output, pending permissions requiring action in BB, no approval payload forwarding, UTF-8 tails for two-, three- and four-byte characters, the exact 8192-byte limit, and safe failure for encoded responses over the complete response limit.
- Thread timeout tests verify abort-signal delivery, discarded output, no later interaction read, and a retained BB read slot until the outstanding SDK read settles. All recorded thread calls are reads.
- Package typecheck, standalone build, `bb plugin types --check`, and repository `npm run check` passed. Existing repository lint warnings outside this package remain.
- Public-SDK-only package scan passed. The package skill validator passed in an isolated `uv` environment after the host Python lacked PyYAML.
- The build uses BB 0.45.0 and SDK 0.6.15. Dependencies remain at the BBP-79 baseline. Existing development-tool advisories remain tracked by BBP-173; no automatic audit repair was attempted.

The single fresh-context read-only completion reviewer approved this local checkpoint with no code-change findings. It independently reran all 59 tests, typecheck, SDK compatibility, repository quality checks and Git whitespace checks. Install, build and skill validation remain worker-verified. Review run: `f3ceb503-6a27-4718-9208-c91184c17e09`. It created no separate BB thread; no separate BB parent link is claimed.

## Safe local feedback steps

These checks use local fixtures. They do not install or enable the plugin:

```sh
npm ci
cd bb-plugin-mcp
npm ci
npm test
npm run typecheck
npm run build
bb plugin types --check
cd ..
npm run check
```

Read [the tool reference and example](README.md#tool-and-request-limits). Check the selected fields, page limits, output bounds, unavailable result, and BB-only approval behavior. Stop here for owner feedback.

## Remaining limits

- No plugin installation, real BB project reads, remote enablement, live OAuth login, PKCE or refresh, tunnel setup, infrastructure changes, or ChatGPT web/mobile checks were run.
- No live agent action or paid agent run was started by these tools. The authorized completion reviewer is separate from tool fixtures.
- Status, output and pending interactions come from separate SDK observations, not one atomic snapshot. Membership and local access are rechecked before return.
- Hidden threads remain readable by direct ID inside an allowed project. Visibility controls default listing, not authorization.
- Free-text assistant output can contain private information. Selected-field projection removes private SDK fields but does not redact text quoted by an agent.
- The SDK output method returns the last assistant output before the plugin applies the 8 KiB transmitted limit. A heavily escaped output or very large title page can return `THREAD_UNAVAILABLE` to keep the complete response bounded.
- Other plugin test suites, hosted CI, and unchanged tunnel-ingress checks were not rerun. Their code and configuration are unchanged.
- Control tools, remote approval and the operation ledger are outside BBP-80.
