# BBP-79 verification checkpoint

Baseline: `0e9e298afa7d6717cb23bc937845384817b53bde`.
Package identity: `mcp` 0.1.0, built with BB 0.45.0 / SDK 0.6.15.
The final checkpoint commit and review evidence are recorded on BBP-79 and in its attached report.

## Verified locally

- Clean package `npm ci`, 38 integration tests, typecheck and standalone build passed on Node 24.15.0.
- `bb plugin types --check` matched the installed BB 0.45.0 SDK 0.6.15.
- The official MCP client exercised initialization, tool discovery, allowed project reads and three reconnects through a real local HTTP listener.
- Authentication tests refused wrong signatures/algorithms/issuers/audiences/owners, absent expiry/read scope, expired and future tokens. Rejected calls made no BB project call.
- A local fixture issuer supplied OIDC discovery and JWKS over a real local HTTP service. A test-only fetch adapter mapped configured HTTPS fixture URLs to loopback; production uses normal HTTPS certificate validation. This tested resource-server verification, not the issuer's login/PKCE/refresh flow.
- Tests covered 65 allowed projects across 50/15-record pages, an excluded project, private field omission, empty access, live removal, in-flight removal and unavailable/oversized results.
- Tests covered settings defaults, invalid stored configuration, persistence through the BB test host's reload boundary, deferred origin/port changes and immediate disable/owner removal.
- Tests covered protocol errors, notifications, sessionless calls, method refusal, Host/Origin checks, ignored forwarding headers, query credentials, declared/streamed body limits, response limits, deadlines, rate/concurrency limits and safe logs.
- Repeated listener start/close and BB lifecycle reload/dispose tests released the port. Shutdown during startup and during an active read also released it. No test invoked a thread mutation.
- The example named-tunnel ingress passed `cloudflared tunnel ingress validate`. Rule checks matched the three permitted paths to the listener and BB admin paths to the 404 rule. No connector was started.
- Repository lint/format checks passed, with existing lint warnings outside this package. The plugin skill passed its validator in an isolated `uv` environment after the host Python lacked PyYAML.
- Production-only dependency audit reported zero findings. Full audit reported nine development entries, including a critical build-tool dependency. Cleanup BBP-173 records the compatible-toolchain investigation and waits for BBP-79; it is not runtime-exposure proof or an automatic-update instruction.

The single fresh-context read-only completion review approved this local checkpoint with no blocking or nonblocking code-change findings. It independently reran tests, typecheck, SDK compatibility, repository quality and ingress checks. Clean install/build, audit and skill validation remained worker-verified evidence. No code fixes were required. The review does not approve live installation or connection.

## Not verified or changed

Plugin installation and live enablement were not approved and were not done. No real BB project data was sent to ChatGPT. No external tunnel, DNS, connector, credential, OAuth grant or BB thread was changed.

Live Keycloak/OAuth client registration, PKCE, refresh, public certificate trust, cookie-free public routing and connector restart remain external setup checks. ChatGPT web and native mobile account/client behavior remain untested. They do not count as passed from local MCP results. Other plugin test suites and hosted GitHub Actions were not run because their runtime code/dependencies are unchanged.

## Safe owner feedback steps

These local checks use generated keys and synthetic projects. They create only temporary loopback listeners and do not install a plugin or enable a public route:

```sh
cd bb-plugin-mcp
npm ci
npm test
npm run typecheck
npm run build
bb plugin types --check
cloudflared --config examples/cloudflared.yml tunnel ingress validate
```

Review the settings names, only-one-tool catalog, page format, and [setup guide](README.md). Stop at this checkpoint for owner feedback. Live installation, owner settings, OAuth grants, public route checks and ChatGPT connections need specific approval.

## Later live check record

Before an approved public test, record the checkpoint commit, artifact metadata, configured resource URL, issuer, selected synthetic/test project and the original plugin/tunnel state without secrets.

For each live target, record date, account plan/workspace, browser or native app version, mobile OS, expected result and observed result. Check discovery, unauthorized/wrong-owner denial, permitted listing, renewal, reconnect, access removal, admin-route refusal and listener disable. A mobile browser is not the native mobile app. The full read/write epic checks belong to its later approved slices.

Restore only approved temporary plugin settings and grants after testing. Preserve the existing named tunnel, connector, DNS, credentials and BB threads. Report each unrun or failed check rather than marking the full connection passed.
