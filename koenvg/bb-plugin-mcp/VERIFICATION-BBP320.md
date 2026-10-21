# BBP-320 queued-input timeout diagnosis

## Finding

The shared test fixture generated a new RS256 key pair inside every test. RSA prime search and its libuv worker queue have no fixed duration. That work consumed the same five-second test budget as authenticated delivery, restart, and no-retry checks.

A controlled reproduction stalls the crypto worker pool without blocking the event loop. The unchanged null-waitingOn queued-input case times out before fixture setup completes or any MCP request starts. This establishes a fixture-setup timeout mechanism, not a null-waitingOn delivery defect.

The historical CI log has no stage-level trace. It cannot prove which stage consumed that run's budget. Its slow neighboring setup-heavy tests are consistent with this mechanism, but do not establish the original runner's load. Evidence comes from the controlled reproduction, not an assumed CI CPU profile.

## Change and safeguards

Generate one signing pair when the fixture module loads, before behavioral test clocks start. Reuse only that key material. Each fixture still owns its listener, issuer, storage, configuration, and mutable public-key object.

Two regressions cover authenticated fixture startup when new key generation is unavailable, and issuer-key mutation isolation between concurrent fixtures. The original queued-delivery, restart, no-retry, and authorization assertions are unchanged. No production code, request deadline, SDK deadline, test timeout, retry configuration, access setting, or installed plugin changed.

## Reproduction

Baseline commit: `4f477695ab0c87e0418df6f40f953515e2bf0036`.
Environment: Node 24.15.0, Bun 1.4.3, Linux container with two CPUs. Dependencies installed from the unchanged package lockfile.

The task's evidence bundle includes `crypto-contention.mjs`. It schedules one asynchronous PBKDF2 operation in each Vitest fork. With `UV_THREADPOOL_SIZE=1`, RSA generation queues behind it. This is a synthetic contention trigger, not a claim that CI ran PBKDF2.

From the package directory, using the absolute path to the attached probe:

```sh
UV_THREADPOOL_SIZE=1 NODE_OPTIONS=--import=/absolute/path/crypto-contention.mjs \
  bun run test tests/send.test.ts -t 'reports queued.*null' --reporter=verbose
```

Baseline instrumentation recorded test entry but never key readiness or request dispatch before timeout:

```text
BBP320_POOL_BUSY
BBP320_QUEUE start 203.727542
FAIL tests/send.test.ts > reports queued/deferred input without retry or completion: null
Error: Test timed out in 5000ms.
Tests  1 failed | 68 skipped (69)
```

The same command after the fix waits for key preparation during module collection, then passes the unchanged behavioral test:

```text
BBP320_POOL_BUSY
BBP320_POOL_FREE 8411.042296
Tests  1 passed | 68 skipped (69)
Duration  8.52s (transform 59ms, setup 0ms, import 8.41s, tests 46ms, environment 0ms)
```

Temporary instrumentation is absent from the submitted code. The fast regression also failed before the fix with `Key generation unavailable` and passed afterward.

## Check results

| Layer or check              | Status         | Evidence                                                                                                                                                |
| --------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit tests                  | Done           | Full MCP suite, 23 files and 603 tests passed on macOS and Linux.                                                                                       |
| Component tests             | Not applicable | No UI or component change.                                                                                                                              |
| Integration tests           | Done           | Real loopback HTTP, JWT verification, MCP client, SDK-boundary and restart checks in the full suite. Linux passed both two-worker and default commands. |
| End-to-end tests            | Not done       | No installed plugin activation, public OAuth client, or live BB mutation. This change is test-only.                                                     |
| Manual verification steps   | Done           | Ran the controlled crypto-contention reproduction before and after the fix. Reviewed the supplied CI failures.                                          |
| Typecheck                   | Done           | Package TypeScript check passed on macOS and Linux.                                                                                                     |
| SDK compatibility and build | Done           | `bun run check:sdk` and `bun run build` passed using pinned local BB tooling and isolated build data. Nothing installed or deployed.                    |
| Lint and format             | Done           | Changed TypeScript files passed repository Oxc checks.                                                                                                  |

The repository-wide `bun run check` also passed after the browser-lifecycle packages' locked dependencies were installed. Its initial missing-dependency failure was setup-only. Existing lint warnings remain unchanged.

Ordinary baseline full suites passed all 601 original tests. Initial broad CPU-throttle experiments produced unrelated read-budget and real-client failures. They were not used to justify deadline changes or infer the precise historical failure. The narrow crypto-worker reproduction above isolates setup from request handling.

## Separate listener failure

The supplied main log failed with `LISTENER_START_FAILED` in production-adapter setup. It did not time out in the send case. That adapter releases its `freePort` probe before starting the plugin, but the historical log does not expose the underlying socket error. Its cause remains unconfirmed. Follow-up BBP-326 retains the log and investigation safeguards. It does not depend on this change.

## Scope and evidence

The task attachments retain the probe, before/after logs, full-suite results, and tool outputs. The independent review and final PR CI results are recorded with the task and PR rather than predicted here.

No UI change, screenshot, or video is applicable. Installed acceptance was not attempted. The user's plugin sources, enabled state, access settings, and `.pi/settings.json` were untouched. Only the task-owned diagnostic container and temporary files were used for runtime experiments.
