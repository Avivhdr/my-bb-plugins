# Check diff controls against running BB

Run this check from an owned BB thread whose environment is this checkout. Keep the existing local BB server and Changes plugin running. The command does not install or reload a plugin.

## Run the check

1. Use Bun 1.4.3, Node 24, and the official `bb` CLI on PATH. Install the locked package dependencies:

   ```sh
   bun install --cwd bb-plugin-changes --frozen-lockfile
   ```

2. Install the package's pinned Chromium if it is missing:

   ```sh
   (cd bb-plugin-changes && bun --bun run playwright install chromium)
   ```

3. Confirm that `BB_SERVER_URL`, `BB_THREAD_ID`, `BB_ENVIRONMENT_ID`, and `BB_HOST_DAEMON_PORT` identify your owned local BB thread. Obtain approval before using a dedicated browser for authenticated verification. This command launches and closes its own headless Chromium. It does not copy credentials or attach to an existing browser.

4. Choose a new evidence directory whose parent exists:

   ```sh
   BB_RENDERER_EVIDENCE="$BB_THREAD_STORAGE/renderer-$(date +%Y%m%d-%H%M%S)-$$" \
     bun run --cwd bb-plugin-changes test:bb-renderer
   ```

The command checks the SDK pin, builds this checkout with BB's official compiler, and runs the browser check. A missing prerequisite or failed assertion exits nonzero. It refuses non-loopback origins and existing evidence directories. Do not point it at another thread's environment.

## Read the result

A pass prints `Passed N BB renderer checks.` with the observed check count. The evidence directory contains `report.json`, `filename-controls.png`, and `native-file-content.png`. The report identifies the checkout, candidate bundle SHA256, Chromium version, native workspace-read URLs, RPC observations, and before/after installation and saved-tab state.

The check uses BB's own React and `@pierre/diffs` runtime shims. It opens the real Changes action and native file viewer through browser input. Mouse, Enter, and Space must each load a known workspace file. Its content differs from the fixture's historical patch. Viewed, filename collapse, deleted files, current rename paths, and historical-target navigation have separate assertions.

The context checks activate **Load context**, then the native above and below controls in Unified and Split views. They cover Enter and Space, read-error retry, refresh during an in-flight request, stale-context fallback, retained original comments, and refusal to comment on revealed lines. Context responses are page-local fixtures. These checks do not verify the candidate backend's file reads.

A second, concurrently open browser context receives an in-memory copy of the same bundle with `renderCustomHeader` changed to `renderHeaderFilenameSuffix`. The same visibility assertion must reject that copy while the positive candidate stays usable. The negative context must still render BB's default filename header. If a future BB supports that slot, reassess this historical negative control instead of suppressing the assertion.

## Isolation and limits

Each page intercepts only its own network requests. The plugin-list response selects this checkout's immutable frontend bytes. Other plugin frontends are omitted in that page to prevent unrelated plugin effects. Changes diff and Viewed RPCs, plus native panel-tab persistence, use page-local fixtures. All other HTTP mutations, unexpected Changes RPCs, and cross-origin requests are blocked and fail the check. Two read-only local host-daemon discovery requests, `/status` and `/workspace-open-targets`, remain real.

BB's renderer, native navigation, environment targeting, and actual workspace file reads are not mocked. The command never edits BB runtime shims or installed plugin sources. It verifies that the installed Changes source, enabled state, status, frontend metadata, and saved thread tabs remain unchanged. It closes its owned browser even after an assertion fails. Separate runs use independent browser processes, contexts, and evidence directories. No fixture server or fixed port is needed.

This is a BB-backed browser check, not a standalone preview or full installed-plugin acceptance. It does not test server diff discovery, durable Viewed storage, or a newly installed candidate backend. CI runs the fixture boundary tests and typecheck. The real-renderer command is a separate acceptance gate because it requires an existing BB instance and an owned local thread. Retain its report with the task or PR.
