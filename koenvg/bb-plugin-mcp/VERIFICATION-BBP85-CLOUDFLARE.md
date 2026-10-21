# BBP-85 Cloudflare fixture checkpoint

This is local compatibility implementation evidence, not web/native acceptance or deployment. The owner approved the explicit Cloudflare local app-permission exception through coordinator `thr_eqpxdi64pk`. Implementation owner is `thr_dgnyi4z8ai`; BBP-85 remains in progress under open BBP-78.

## Implemented contract

- Default `bearer-jwt` retains RS256 OIDC discovery, exact owner/resource audience, expiry and original `bb.read`/`bb.control` checks.
- Explicit `cloudflare-access` validates a bounded signed `Cf-Access-Jwt-Assertion`: RS256, trusted fixed team-origin key endpoint, exact issuer/owner/app AUD, expiry, optional validity/issuance claims and application type. No cookie/header-presence trust, token-selected key URLs or credential fallback.
- Cloudflare permission is LOCAL `read` or `read-control`, default read. It is not a propagated OAuth scope. All valid owner/app sessions share it. Writes also require local control enabled. Forged scope/permission claims do not elevate read access.
- Current mode/issuer/owner/AUD/expiry/project/role checks apply after waits, before dispatch and cached private replies. Operation inspection can remain read-only. Issuer/owner/tool/key identities, ledger/unknown/generation protection and ordinary BB execution arguments remain unchanged.
- Public metadata keeps the OAuth server issuer separate from the Access assertion issuer and does not advertise unproved Cloudflare BB scopes. Settings and local status show the selected mode/app permission; both remote and control defaults remain disabled.
- No hard-coded owner/team/domain, new dependency, install, runtime setting, route, grant, actual MCP call or real BB work was introduced. The ingress example is fixture documentation, not an operator configuration change.

## Fresh validation

Recorded on 2026-10-11, against pre-implementation baseline `144f16d8faa9423554d681de22a6b3aba13c383c`:

| Check                             | Result                                                                                                                                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package tests                     | 341 passed, 14 files; includes 66 new Cloudflare cases. The earlier 275-test result is baseline evidence, not this result.                                                                                          |
| TypeScript                        | Passed using pinned SDK 0.6.15.                                                                                                                                                                                     |
| Standalone supported-target build | Passed with existing local BB 0.45.0, SDK 0.6.15, Node 24.15.0. No package pins changed.                                                                                                                            |
| Supported-target SDK surface      | `env -u BB_CLI ./node_modules/.bin/bb plugin types --check` passed from the package.                                                                                                                                |
| Public SDK/dependency scan        | Passed in the package suite. No private SDK paths or new dependencies.                                                                                                                                              |
| Root lint/format                  | Passed; existing warnings outside this change remain.                                                                                                                                                               |
| Strict OpenSpec                   | `openspec validate bb-chatgpt-mcp --strict --no-interactive` passed.                                                                                                                                                |
| Whitespace/static ingress         | Passed; exact-host fallback rejects the fixture BB admin path with HTTP status 404 before any wildcard route. No connector was started.                                                                             |
| Actual host SDK surface           | Global CLI is now BB 0.46.0 with SDK 0.6.37, not the original baseline. Global types check reports the older pin and exits 1. No update was applied. Live-host compatibility is a separate unresolved prerequisite. |

Build invocation for the supported target: `env -u BB_CLI ./node_modules/.bin/bb plugin build` from `bb-plugin-mcp`. Clearing BB_CLI only selects the already installed local compiler; it does not change the running BB server or reporting identity. The initially invoked global build succeeded but stamped the newer host SDK; it was replaced by the supported-target build.

Final local artifact hashes:

- `dist/server.js`: `66ed44bac6cd712f5d2ae5f1574550b29cb4eda54d94c88f51df211021ea7c0a`
- `dist/server.meta.json`: `63e8141431a35d57ad6ac2ca14352223e37f1b50574e47e72f59fdfde1a5c288`, BB 0.45.0 / SDK 0.6.15.

Fixtures use generated RSA keys, synthetic HTTPS key retrieval (or a real loopback key server), real loopback HTTP/official MCP client and temporary SQLite-backed fake-plugin-host effects. They cover malformed/combined/unsigned assertions, claims/signatures/algorithms/keys, fixed key source/cache rotation/abort limits, no fallback, local role/control matrix, grant sharing, post-wait/cached-result revocation, mode-stable operation identity, persistence, unknown/no-replay behavior and normal BB start/send/stop arguments. Existing queue/permission/generation/deadline regressions also pass. They do not prove Cloudflare's actual grant/token refresh or the current live host.

## Review and deployment gates

One fresh real BB child completion reviewer is required on the settled full diff from the baseline, using the `review` skill because the change crosses authentication/authorization contracts and modules. The parent/checkout must be verified before BEGIN. Review identity, candidate commit, result and confirmed task evidence are recorded in BBP-85 and thread storage after the review; this file does not claim a review pass in advance.

No Cloudflare setting, DNS/route/tunnel/connector, website, BB installation/reload, remote/control enablement or OAuth grant was changed. No real project reads, agent starts/messages/stops or live provider costs were used for acceptance. The independent reviewer itself is the separately approved BB child exception. No main merge or push.

Missing for later approved setup: exact ChatGPT callback, new isolated app AUD, real OAuth discovery issuer, owner assertion confirmation, save-time 15m/336h entitlement, operator-confirmed port/host-specific routing, current-host SDK compatibility, disposable project/cost approval and real web/native OS/app/account evidence. Email PIN is not MFA. Fourteen days is not a maximum or permanent sign-in promise. Keep the operation ledger/history through rollback. Native mobile acceptance remains incomplete.
