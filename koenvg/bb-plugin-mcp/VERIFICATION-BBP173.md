# Standalone build dependency review

BBP-173 updates only the development npm dependency of `bb-app`. It removes the installed `tar` critical finding and the `pacote` finding. Five development packages still have advisories. This is a bounded mitigation, not a clean full audit or a reproduced exploit.

## Current baseline and change

The reviewed baseline is `660bcc033c7ce3a0e6ddff0b3caa60351e6ca48d`. Main has merged the MCP package and the repository's Bun migration. The older BBP-173 description names a removed npm lockfile and BB 0.45. The merged package instead uses Bun 1.4.3, BB 0.46.0 and SDK 0.6.37. This change preserves that current contract. It does not restore BB 0.45 support or introduce an npm lockfile into the repository.

`package.json` now overrides npm to exactly 11.21.0, the current npm 11 release. The BB builder remains pinned to 0.46.0 and the SDK to 0.6.37. The generated `bun.lock` changes only npm and its descendants. All other lock entries, production dependency declarations and runtime source files are unchanged. npm 11.21.0 supports Node 24.15.0. npm 12.2.0 was inspected but not selected: its archive still includes the five affected packages, so a major upgrade would not remove these findings.

No `audit fix`, plugin installation, remote enablement, runtime auth change, task dispatch or notification was used.

## Installed evidence

Versions below come from actual installed manifests after clean frozen Bun installs, not only from lockfile declarations. The initial builder resolved npm 11.16.0; the candidate resolves npm 11.21.0. These packages are under `node_modules/npm/node_modules`.

| Package                 | Before | After  | Remaining highest severity |
| ----------------------- | ------ | ------ | -------------------------- |
| tar                     | 7.5.15 | 7.5.22 | None in this audit         |
| pacote                  | 21.5.0 | 21.5.1 | None in this audit         |
| brace-expansion         | 5.0.6  | 5.0.9  | High                       |
| http-cache-semantics    | 4.2.0  | 4.2.0  | High                       |
| ip-address              | 10.2.0 | 10.5.0 | Moderate                   |
| postcss-selector-parser | 7.1.1  | 7.1.4  | Moderate                   |
| undici                  | 6.26.0 | 6.28.0 | High                       |

The installed candidate's full registry bulk audit reports 12 advisories across those five remaining packages. A separate npm audit reports five dependency entries, three high and two moderate, with no critical entries. The installed production graph and `npm audit --omit=dev` both report zero findings. Advisory counts and dependency-entry counts are different measures. Registry results can change after this checkpoint.

Residual advisories:

- `brace-expansion`: [nested recursion](https://github.com/advisories/GHSA-qhr7-859c-m2p7), [comma recursion](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p), [quadratic expansion](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr). Patched range starts at 5.0.12.
- `http-cache-semantics`: [cross-user cached response disclosure](https://github.com/advisories/GHSA-ch52-4w7c-c8xp), patched in 4.3.0.
- `ip-address`: [link-local classification](https://github.com/advisories/GHSA-rpw4-54j3-4h4q), [NAT64 classification](https://github.com/advisories/GHSA-2vr4-cq9g-pvrc), [cross-family subnet checks](https://github.com/advisories/GHSA-j6r3-76f7-8jcv), [unbounded parse diagnostics](https://github.com/advisories/GHSA-h3mg-xc3c-68pw). A version newer than 10.7.0 is needed for this set.
- `postcss-selector-parser`: [quadratic parsing](https://github.com/advisories/GHSA-rj75-hqrm-r3gf), patched in 7.1.6.
- `undici`: [WebSocket decompression](https://github.com/advisories/GHSA-3wwx-pv8p-q78v), [response splitting](https://github.com/advisories/GHSA-r53p-7pc4-xj5r), [unrequested WebSocket subprotocol](https://github.com/advisories/GHSA-rfgv-xxqx-mfg5), patched in 6.28.1.

## Audit limit and bounded use

Bun 1.4.3 can retain old nested npm lock entries after an npm override. Here, `bun audit --json` still reports the original seven package names and 33 advisories, including old `tar` and `pacote` entries that do not match the installed candidate. A fresh lockfile experiment had the opposite problem: it selected newer nested versions and reported zero, while a clean install still used npm's older bundled files. That experiment was discarded. The final lockfile preserves every non-npm entry from main.

Do not use a Bun audit result alone to claim that npm's bundle is patched. Inspect the installed manifests and audit their exact versions, including nested `node_modules`. The evidence includes the manifest scanner and both registry responses. npm's own clean-install audit independently confirms the five residual dependency entries. No bundled files were patched or replaced by an install hook.

Keep this local dependency set for standalone verification of a trusted checkout. Use frozen Bun installs. Do not use this development builder to self-update BB, install arbitrary npm revisions, inspect untrusted archives or repositories, or access a live account. Use a disposable build environment without live credentials when testing untrusted input. This bounds exposure; it does not repair the remaining bundled packages. Recheck the installed bundle when npm publishes a patched npm 11 release. Do not downgrade BB, change SDK metadata, or add a runtime workaround to silence development advisories.

The dependency path is `bb-app -> npm`. The published BB launcher resolves that npm CLI for its npm-revision installation path. These dependencies remain development-only for this plugin. The local build and fixture tests passed without an installation or self-update action. No exploit attempt or proof that every BB command is unaffected is claimed. The override is verified for this package's local test/typecheck/build path, not for unrelated BB lifecycle commands or the separately installed BB application.

## Verified checks

- Clean `bun install --frozen-lockfile` passed after removing this package's generated `node_modules`.
- Clean `npm ci` passed in a separate probe directory using an unchanged copy of the candidate manifest and a newly generated npm lockfile. It is a compatibility/audit probe, not the repository's authoritative install. No npm lockfile is checked in. The probe's affected npm bundle versions match the Bun installation.
- Installed full and production registry audits completed. Full has the five residual packages above; production has zero. Native Bun full audit exited 1 with the documented stale lock findings. npm full audit exited 1 with five residual entries; npm production audit exited 0.
- `bun run test` passed all 343 tests in 15 files. These include the existing authentication and operation safeguards. No new test was needed for an override-only change.
- `bun run typecheck` passed without changing strictness.
- `env -u BB_CLI bun run build` passed using the package's standalone BB 0.46.0 builder, not a host CLI override.
- Local standalone and installed-host `bb plugin types --check` both passed with SDK pin and host version 0.6.37.
- Built `server.js`, `server.js.map` and `server.meta.json` have the same SHA-256 hashes as the pre-change build. Metadata remains artifact format 1, plugin `mcp` 0.1.0, BB 0.46.0 and SDK 0.6.37.

Repository `bun run check` and `git diff --check` passed. Lint reports existing warnings in unrelated files. Independent review results are recorded in the task report. Live installation, OAuth, tunnel, ChatGPT web/mobile and unrelated plugin suites are outside this maintenance change and were not run.

Evidence: [BBP-173 thread](bbthread://thr_69548xju49). Raw audit responses, installed manifests, npm probe lockfile, command logs and artifact hashes are in that thread's `bbp173` evidence directory and task attachments.
