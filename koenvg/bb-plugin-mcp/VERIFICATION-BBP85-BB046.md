# BBP-85 BB 0.46 compatibility checkpoint

This is fixture and build compatibility evidence, not installation or live acceptance. The owner approved the bounded BB 0.46 update through `thr_eqpxdi64pk`; `thr_dgnyi4z8ai` remains the sole implementation owner.

## Target and changes

Starting clean commit: `6be6aa30fd4fe7e9e7c6887b5380a6cb7df68b7f`. Its [BB 0.45 Cloudflare checkpoint](VERIFICATION-BBP85-CLOUDFLARE.md) and the repository's earlier BB 0.45 records remain unchanged. Use that revision for the earlier verified target.

Read-only host checks confirmed BB **0.46.0** and SDK **0.6.37**. The old SDK check failed with exit 1. No host beyond the approved BB 0.46 scope was used.

Only the MCP package's SDK/dev-compiler pins, minimum engines, matching lockfile and current documentation changed:

- SDK development pin: 0.6.15 → 0.6.37.
- Standalone BB development compiler: 0.45.0 → 0.46.0.
- Current package minimums: BB >=0.46, SDK >=0.6.37 <0.7, Node >=24.15.0 <25.
- Only those two lockfile package versions/resolutions/integrities changed. No new or unrelated dependencies and no production dependency change.
- No runtime TypeScript or fixture implementation change was needed. No declaration edits, weakened checks, private API or execution-authority expansion.

The exact newly verified pair is BB 0.46.0 / SDK 0.6.37. Later BB/SDK/Node versions allowed by engine ranges are not individually verified here. This new candidate does not claim BB 0.45 compatibility.

## Public contract inspection

Compared the published SDK 0.6.15 and 0.6.37 declarations, not private BB APIs. Project execution-default schema/arguments, thread spawn/send/status/stop contracts, thread response schema and interaction interface used by MCP remain compatible. The queue area adds experimental edit-hold/release methods; MCP does not call or expose them. Input/queued-message schemas add attachment mentions and optional attachment host/source-project fields. MCP's strict text-only tool schemas do not expose those inputs. Existing public export names remain available; SDK 0.6.37 adds `experimental_THREAD_ACTION_GROUPS`, which MCP does not use.

The unchanged runtime still verifies Cloudflare signature/issuer/owner/app AUD/expiry/type, uses explicit LOCAL shared owner/app read/read-control permission (default read), requires local control as well for writes, preserves bearer BB scopes and current-access rechecks, and retains operation identity, ledger/duplicate/unknown/generation protection and normal BB defaults/permissions/queueing. Both remote/control defaults remain disabled.

Existing boundary fixtures cover the affected callers and safeguards. No extra internal/version-string test was added; strict typechecking, official SDK compatibility checks and the full suite are the relevant checks for this pin-only delta.

## Fresh checks and exact versions

Recorded 2026-10-11. Toolchain: Node 24.15.0, npm 11.12.1, TypeScript 5.9.3, Vitest 4.1.11, global and local BB 0.46.0, installed SDK 0.6.37. Production pins remain MCP SDK 1.32.1, jose 6.2.12 and zod 4.6.5.

| Check                                     | Result / exit                                                                                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Lockfile reproduction                     | `npm ci --ignore-scripts`, then only the required local `better-sqlite3` rebuild: 0. BB/SDK packages have no install hooks. No plugin installation occurred. |
| Full package regression/security fixtures | 341 passed / 14 files, including all 66 Cloudflare cases, exit 0, now using SDK 0.6.37. Not the old-version test result.                                     |
| Strict TypeScript                         | Passed, exit 0. `skipLibCheck=false` remains unchanged.                                                                                                      |
| Actual current-host SDK surface           | Global `bb plugin types --check` passed, exit 0, pin=host=0.6.37. This resolves the earlier recorded SDK gap without weakening the check.                    |
| Local compiler SDK surface                | Local BB 0.46.0 declarations check also passed, exit 0.                                                                                                      |
| Standalone global build                   | Passed, exit 0; metadata stamps BB 0.46.0 / SDK 0.6.37. No older compiler or SDK stamp substitution.                                                         |
| Public SDK scan                           | Passed as part of the full suite.                                                                                                                            |
| Repository lint/format                    | Passed, exit 0, with existing unrelated lint warnings.                                                                                                       |
| Strict OpenSpec / whitespace              | Passed, exit 0. No requirements or task-history changes.                                                                                                     |
| Static ingress validation/rules           | Passed, exit 0: MCP/discovery route to dedicated loopback service; admin path matches host-specific 404 before wildcard. No connector or real route change.  |
| Production audit                          | Zero findings, exit 0. Installation still reports nine existing development findings (1 moderate, 7 high, 1 critical); no audit-fix or unrelated upgrade.    |

Built artifact hashes:

- `dist/server.js`: `66ed44bac6cd712f5d2ae5f1574550b29cb4eda54d94c88f51df211021ea7c0a`, unchanged from the approved Cloudflare implementation.
- `dist/server.meta.json`: `24870a27eb9b870606ad6c82ef22b310129da7ff246f15a520d758d5f4bdb157`, now BB 0.46.0 / SDK 0.6.37, artifact format 1, plugin mcp 0.1.0.

Logs, public declaration comparisons and approval/checkpoint records are in BBP-85 attachments and implementation thread storage. The one fresh actual BB child completion reviewer is independently parent/workdir/HEAD-verified before BEGIN. Its identity, final verdict and local candidate commit are recorded after review; no review pass is claimed in advance by this file.

## Remaining limits

No plugin install/reload/settings, remote/control enablement, Cloudflare/browser/app/policy/provider/DNS/route/tunnel/connector change, OAuth grant, real project read or agent/cost acceptance action occurred. No merge or push. BBP-85 and BBP-78 remain in progress.

Still missing for separately approved setup: exact ChatGPT callback, new dedicated app AUD, real OAuth issuer and owner assertion, saved duration/entitlement, operator-confirmed listener/routing, approved disposable project/costs and real web/native OS/app/account tests with recovery and rollback. Email PIN is not MFA. Fourteen days is not a maximum or permanent-login promise. Passing current SDK declarations/build/fixtures is not proof of installed runtime behavior or native mobile support. The coordinator owns the next external setup approval.
