# BBP-200 issuer URL verification

Source: [BBP-200 implementation thread](bbthread://thr_dmw4ecqxy2).
Baseline: `33ef43851e032b03bf21fd3f8e81498a242fe610`.
Scope: MCP issuer validation, discovery URL construction, boundary tests and setup documentation.

## Reproduction and change

Current baseline code rejected slash-ending issuers and requested a double-slash discovery path. Before the runtime change, the focused suite had 6 failures and 76 passes. Failures covered root and realm issuers through the settings lifecycle, public authenticator and real MCP HTTP client.

The validator now accepts an exact canonical HTTPS URL or its origin without changing the saved issuer. Discovery removes one final slash from the endpoint base only. Discovery issuer equality, JWT issuer equality and cache identity still use the original string. Signature, audience, expiry, owner and scope verification are unchanged. Cloudflare assertion issuers still require a team origin without a final slash.

## Verified checks

Environment: Bun 1.4.3, Node 24.15.0, plugin SDK 0.6.37.

| Check                                                                                                                                       | Result                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `cd bb-plugin-mcp && bun install --frozen-lockfile`                                                                                         | Passed; no lockfile change                              |
| `bun run --cwd bb-plugin-mcp test tests/issuer-auth.test.ts tests/remote.test.ts tests/lifecycle.test.ts tests/cloudflare-settings.test.ts` | 82 tests passed                                         |
| `bun run --cwd bb-plugin-mcp test`                                                                                                          | 372 tests passed across 16 files                        |
| `bun run --cwd bb-plugin-mcp typecheck`                                                                                                     | Passed                                                  |
| `bun run --cwd bb-plugin-mcp build`                                                                                                         | Passed                                                  |
| `bb plugin types --check bb-plugin-mcp`                                                                                                     | Passed; package pin and host SDK both 0.6.37            |
| `bun run check`                                                                                                                             | Passed; existing warnings outside the changed MCP files |
| `git diff --check`                                                                                                                          | Passed                                                  |

Tests cover root and realm issuers with and without a final slash, matching discovery/JWT acceptance, slash-only discovery/JWT mismatches in both directions, exact metadata and settings persistence across reload, invalid URL inputs and unchanged Cloudflare origin policy. Existing authentication tests still cover forged signatures, wrong algorithms, audience, expiry, owner and scope rejection.

## Independent review

One fresh read-only `routine-review` approved the complete working-tree change against the baseline, with no blocking findings or substantial cleanup defects. Reviewer run: `0243ddb2-8b38-461e-b262-384294c3613a`. The reviewer independently verified all 82 focused tests and the baseline diff check. Full tests, type checking, build, SDK and repository checks are parent-verified, not reviewer-rerun. The change is small and localized, with no new runtime abstraction.

## Limits

This is local fixture and build evidence. No live Auth0 tenant, login, account, plugin installation, public route, tunnel or ChatGPT connection was tested or changed. Live setup needs separate approval. BBP-85 remains independent. No additional substantial cleanup defect was found in the edited or adjacent code.
