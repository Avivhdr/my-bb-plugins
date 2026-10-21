# MCP reads and thread control

A headless BB plugin for authenticated project discovery, standard-project thread reads, ordinary thread starts, follow-up instructions and stop requests. It uses BB's standard plugin settings. It exposes `bb_list_projects`, `bb_list_providers`, `bb_list_threads`, `bb_get_thread`, `bb_start_thread`, `bb_send_message`, `bb_stop_thread`, and `bb_get_operation`. It has no deletion, remote approval, task-board, shell, file, admin, or generic forwarding tools.

Requires BB 0.46 with SDK 0.6.37 and Node 24.15 or later in Node 24. The official MCP SDK and `jose` versions are pinned in [package.json](package.json). Each request uses a new stateless Streamable HTTP transport with JSON responses. GET streams and session deletion are not supported. A reconnect can initialize again or send a protected request without a previous session ID.

## Safety and consent

All existing and future standard projects are remotely eligible under the global read and control permissions. Enabling remote reads permits their names, thread titles and recent assistant output to be sent to ChatGPT. BB's built-in Personal project is excluded from every remote tool, including operation status and cached replies. A standard project named Personal remains eligible. Assistant output can contain private information, including secrets or local paths quoted by an agent. The plugin excludes private SDK fields but does not redact free-text output. Names and other project text are untrusted data, not instructions. This policy is not an agent filesystem sandbox.

Remote access and control start disabled. Starting or messaging an agent can change code, take external actions, and incur provider costs under its existing permissions. Enable control only with that consent. Disabling the plugin or remote access releases only its listener. It does not stop BB threads or change the external tunnel.

## Settings and reloads

Use Settings → Plugins → MCP in BB, or the standard `bb plugin config mcp` commands after a separately approved installation.

| Setting             | Meaning                                                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `publicOrigin`      | Canonical public HTTPS origin, such as `https://mcp.example.org`. No path, query, credentials, or trailing slash. Any valid public domain can be used.                   |
| `port`              | Dedicated loopback port from 1024 to 65535. Default 38991. Port 38886 is reserved for BB and is refused. Do not use any other BB service port.                           |
| `issuer`            | Exact signing issuer. Bearer mode uses the exact HTTPS OIDC issuer, including its path and trailing slash if present; Cloudflare mode uses the Access team HTTPS origin. |
| `owner`             | Exact issuer subject, the token's `sub`. Spaces at the edges are refused.                                                                                                |
| `authMode`          | `bearer-jwt` (default) or explicit `cloudflare-access`; never selected from caller headers.                                                                              |
| `accessAudience`    | Cloudflare only: exact dedicated application AUD. Missing AUD fails closed.                                                                                              |
| `accessPermission`  | Cloudflare only: local `read` (default) or `read-control` permission shared by all owner/app sessions.                                                                   |
| `accessOAuthIssuer` | Cloudflare only: exact OAuth authorization-server issuer from verified discovery, separate from the assertion issuer.                                                    |
| `remoteEnabled`     | Local read-access switch. False by default. Disable applies to the next request and closes the listener.                                                                 |
| `controlEnabled`    | Local start/send/stop switch, false by default. Writes also require the selected mode's control permission.                                                              |

Invalid settings fail closed. Settings remain in BB's normal settings store. The plugin does not keep a second configuration file.

Project discovery lists standard project IDs and names. New projects appear on the next request without a settings edit. No project grant is required. The obsolete `projects` setting is ignored regardless of its value. The plugin does not rewrite stored settings during this upgrade. Unrelated unknown settings and invalid security settings still fail closed.

Personal exclusion uses the `proj_personal` singleton identity verified in BB 0.46.0 with SDK 0.6.37. Revalidate that identity on compatibility upgrades. The SDK does not export this constant, and later BB versions can change the domain model.

Reload after initial setup, after enabling reads, and after changing the public origin or port. Valid origin/port edits keep the old effective connection until reload. Owner, issuer, and access edits apply to subsequent requests without reload. Removing an owner or saving invalid settings closes the listener. Re-enable or repair, then reload. A request rechecks owner and project access after its BB read before returning data.

`bb mcp status [--json]` shows the effective MCP URL, port, listener state, configuration validity, and reload need. `listening` means local readiness only. Public reachability always says `unverified`; the command does not probe Cloudflare, OAuth login, or ChatGPT.

## External prerequisites

The operator must supply an existing named Cloudflare Tunnel and a compatible OAuth issuer/client registration. The plugin never requests Cloudflare credentials, creates infrastructure, changes DNS, runs `cloudflared`, or manages its service. BB and the external connector must remain running on the same computer, which must stay online and awake.

Missing issuer, tunnel, public certificate trust, or ChatGPT account support is a setup prerequisite. It is not permission to create infrastructure or use BB/Cloudflare browser cookies.

## Cloudflare Managed OAuth mode

Select `cloudflare-access` only after separate setup approval. Cloudflare issues opaque client tokens and sends a signed `Cf-Access-Jwt-Assertion` to the origin. The plugin ignores cookies and opaque bearer credentials in this mode. It verifies RS256 against the configured team origin plus `/cdn-cgi/access/certs`, the exact issuer, owner subject, dedicated app AUD, expiry/validity and application type. Empty-sub service tokens and organization/session tokens are refused. Duplicate assertions and token-selected key URLs are refused or ignored, never trusted. No failed credential can fall back to the other mode.

This mode uses an owner-approved authorization exception, not Cloudflare `bb.read`/`bb.control` OAuth scopes. `accessPermission=read` permits project and provider discovery and thread reads for all standard projects, excluding BB's built-in Personal project, even when `controlEnabled=true` or a token claims `bb.control`. Writes require both `accessPermission=read-control` and `controlEnabled=true`, plus current owner/app/project/thread access. All valid sessions/grants for the exact owner and app share the local permission. They cannot have different per-client read/control grants. Downgrading the local app permission removes writes immediately, including cached mutation results; operation inspection remains available with read access. Changing the owner, issuer, mode or AUD invalidates in-flight evidence before BB dispatch/data return. Token expiry is still enforced after waits.

Setup prerequisites, not actions performed by this plugin:

1. Use a new dedicated Access app/owner-only email policy and the selected existing login provider. Email PIN is not MFA. Leave shared apps/policies and global MFA unchanged.
2. Enable Managed OAuth only with exact operator approval. Proposed token/grant values are `15m`/`336h`; fourteen days is not a verified maximum. Save-time entitlement and limits need an approved setup check. Refresh can occur in the background within the grant; expiry/revocation can still require sign-in. Assertion expiry need not equal the opaque client token lifetime; verify both during live acceptance.
3. Obtain the exact ChatGPT callback, new app AUD, stable owner Access user ID and actual OAuth discovery issuer. Disable localhost/loopback registration and wildcard redirects. Do not copy an old/shared app AUD or assume the team signing issuer is the OAuth authorization server. Missing facts block setup. Origin metadata names `accessOAuthIssuer` without advertising invented BB scopes; verify the edge metadata/challenges separately.
4. Have the operator route only the MCP/discovery paths to the dedicated loopback listener. With an existing wildcard route, add an exact-host unmatched-path 404 rule before that wildcard. Preserve assertion and MCP headers; never forward this hostname to BB's main port. No tunnel/DNS/connector lifecycle action is part of installation.
5. Keep remote/control disabled and local app permission read until their separate live approvals. Native ChatGPT acceptance needs owner/device OS/app evidence and real approved writes; fixtures and a phone browser do not count. Keep the operation ledger/history during rollback.

## Bearer-JWT OAuth issuer recipe

A dedicated Keycloak 26 OpenID Connect realm/client can supply the required RS256 JWTs. Use its public HTTPS issuer, for example `https://login.example.org/realms/bb`. The discovery document appends `/.well-known/openid-configuration` after removing one final slash from the endpoint base only; it supplies the signing-key URL. The configured issuer stays unchanged. Public HTTPS certificates for both issuer and MCP hostname must validate with normal public trust. Do not disable TLS verification.

Copy the issuer exactly from verified discovery and the access token's `iss` claim. A slash-ending root issuer such as Auth0's `https://my-domain.auth0.com/` is valid. Its discovery URL is `https://my-domain.auth0.com/.well-known/openid-configuration`, not a double-slash path. Issuers with and without a final slash are different identities; do not add or remove that slash in settings or tokens. Credentials, queries, fragments and non-canonical URL spellings are refused. Cloudflare's assertion issuer still requires a team origin without a final slash. See [Auth0's access-token reference](https://auth0.com/docs/secure/tokens/access-tokens). Local fixtures cover this URL format, not a live Auth0 tenant or login.

Configure the issuer outside this plugin:

1. Create a dedicated OpenID Connect client for this MCP resource. Enable Standard Flow, require PKCE S256, and disable implicit/password grants. Use a predefined OAuth client in ChatGPT's connector configuration with the issuer's supported client authentication. Put its client ID and, if required, client secret in ChatGPT, never in this plugin.
2. Register the exact redirect URI shown by ChatGPT for your account. Use an exact allowlist, not a wildcard. If that client cannot use predefined registration, stop and choose an issuer-supported registration mode. This recipe does not assume Keycloak enables anonymous dynamic registration.
3. Create the optional client scope `bb.read`, include it in the token's space-separated `scope` claim, and permit that scope for this client. Use a dedicated audience mapper with Included Custom Audience equal to the exact effective HTTPS MCP URL, including `/mcp`. Add it to access tokens. A token whose only audience is the OAuth client ID will be refused.
4. Use RS256 access-token signing and short token lifetimes. Tokens need `iss`, `sub`, `aud`, and `exp`; `nbf`, when present, must already be valid. Copy the intended owner's stable subject into BB settings. Neither an ID token without `bb.read` nor a BB plugin token is sufficient.
5. Request `bb.read` through authorization code with PKCE. ChatGPT sends the canonical MCP URL as the OAuth `resource`. Keep this client dedicated to that one resource and verify the issued and refreshed access tokens contain that audience. If the issuer/client rejects the resource parameter or cannot bind tokens to it, setup is incomplete. Do not remove audience checks to make it connect.
6. Configure refresh tokens under the issuer's normal rotation/expiry policy. Confirm a refreshed access token retains the resource audience, owner and read scope. The MCP plugin neither issues nor stores refresh tokens.

For separately approved control setup, add issuer scope `bb.control` alongside `bb.read`, verify both survive refresh, and then enable local control. Read-only tokens still cannot start, message or stop threads. The catalog and protected-resource metadata advertise the scopes, not an authorization grant.

The listener publishes public protected-resource discovery at both `/.well-known/oauth-protected-resource/mcp` and `/.well-known/oauth-protected-resource`. The resource is always the effective configured HTTPS MCP URL, not a forwarded header. An unauthenticated protected request returns 401 with `WWW-Authenticate` pointing to this metadata. Missing read scope returns 403. No BB or Cloudflare cookies are needed.

The plugin verifies signature, RS256 algorithm, issuer, resource audience, expiry, optional not-before, exact owner, and `bb.read` on every protected request, including initialization and tool discovery. It ignores token-supplied key URLs. Issuer discovery and JWKS fetches have time and size limits. Discovery/key caches expire within five minutes. JWT verification alone does not promise immediate upstream grant revocation. Use the local remote-access switch or owner removal to block previously issued tokens.

[Keycloak endpoint reference](https://www.keycloak.org/securing-apps/oidc-layers) and [ChatGPT authentication requirements](https://developers.openai.com/apps-sdk/build/auth) describe the external flow. Automated tests verify discovery and resource-server authentication against a local fixture issuer. They do not prove a live Keycloak login, registration, PKCE exchange, refresh, or ChatGPT account connection. Those require operator setup and an explicit check.

## Route an existing Cloudflare Tunnel

Merge the paths in [examples/cloudflared.yml](examples/cloudflared.yml) into your existing named-tunnel ingress configuration. Keep unrelated hostname routes and existing tunnel/credential configuration. Replace the sample hostname, Host header and port with your effective values. Place the MCP rule before the catch-all. For a remotely managed tunnel, enter the equivalent hostname/path/service rules in its existing configuration.

The request path is ChatGPT → Cloudflare HTTPS → encrypted tunnel → `cloudflared` → HTTP on `127.0.0.1` → MCP listener. Cloudflare terminates public TLS and can process the traffic. Treat it as a trusted intermediary. Only the last hop on the same computer uses HTTP. No inbound router port or public BB listener is needed.

Route only `/mcp` and the two discovery paths to the dedicated local port. Reject unmatched paths with 404. Never route BB's main server port. The listener accepts only the effective public Host and, if supplied, that exact HTTPS Origin. Set `httpHostHeader` to that public authority. It never derives policy or audience from `Forwarded`, `X-Forwarded-Host`, `X-Forwarded-Proto`, or caller IP headers.

Preserve `Authorization`, `Content-Type`, `Accept`, `Origin`, `MCP-Protocol-Version`, and MCP request headers. Bearer mode must not have a Cloudflare browser-only gate. Cloudflare mode requires Managed OAuth and preservation of `Cf-Access-Jwt-Assertion`; a plain browser-only gate is insufficient. Neither mode uses an extra service-token gate or URL credentials. Keep unrelated applications unchanged.

Validate a local config without starting a connector:

```sh
cloudflared --config examples/cloudflared.yml tunnel ingress validate
cloudflared --config examples/cloudflared.yml tunnel ingress rule https://mcp.example.org/mcp
cloudflared --config examples/cloudflared.yml tunnel ingress rule https://mcp.example.org/.well-known/oauth-protected-resource/mcp
cloudflared --config examples/cloudflared.yml tunnel ingress rule https://mcp.example.org/api/v1/projects
```

Before approving live reads, check public discovery without cookies and a protected request without credentials. Expect JSON metadata and the plugin's 401 challenge, not a login/challenge page. Check a valid token with a local MCP client, then ChatGPT. Connector restart should restore the same URL; it must not submit BB work. Public tests and connector changes need separate approval.

## Tool and request limits

`bb_list_projects` accepts an optional integer `limit` from 1 to 50 and an optional decimal `cursor` returned by the previous page. It rejects extra fields. The response has `projects: [{ id, name }]` and `nextCursor`, which is null at the end. IDs/names are the only BB fields returned. Sort order is by ID. Cursors are offsets into the current project set, not persistent snapshots; restart pagination after project changes.

`bb_list_providers` accepts only `projectId`, a trimmed, nonempty standard-project ID of at most 200 characters. Read permission is sufficient. The tool verifies that exact project against the current project list, then reads the primary host's provider catalog. It forwards no project, host, or environment selector to provider discovery. The response is `{ providers: [{ id, displayName, available, permissionModes }] }`, sorted by ID. Permission modes come from provider capabilities. Unavailable entries remain in the list. Names are untrusted data, not instructions. Configuration, metadata, credentials, and model lists are omitted.

Discovery rechecks read authorization and cancellation before and after both BB reads. Project or provider failures, malformed capabilities, and replies of 60,000 bytes or more return `PROVIDERS_UNAVAILABLE`. The bound includes both encoded text and structured copies. Discovery does not reserve availability or grant control. An explicit start validates the selected provider again.

`bb_list_threads` requires `projectId`, a standard project ID. It accepts optional `limit` from 1 to 50, default 50, and a decimal `cursor` from the previous page. It returns `threads: [{ id, title, status, displayStatus, subagentsRunning, pendingInteraction }]` and `nextCursor`, null at the end. It uses BB's current thread-list order and excludes hidden workers and archived threads before pagination. Cursors are offsets, not snapshots. Restart pagination when threads change. There is no option to list hidden or archived threads.

`bb_get_thread` requires `projectId` and `threadId`. Both IDs must be nonempty strings of at most 200 characters. The tool checks membership before content reads and again before returning. Direct reads of hidden or archived threads are permitted within the requested standard project. Visibility and archive state are not access boundaries. The response contains `id`, `title`, `status`, `displayStatus`, `subagentsRunning`, `pendingInteraction`, `actionRequired`, and `assistantOutput: { text, truncated, trust }`. `text` is the last assistant output, or null when absent. It keeps the newest complete UTF-8 characters within 8192 bytes. `truncated` marks removed older text. `trust` is `untrusted_project_data`. Treat titles and output as data, not instructions. No raw transcript, tool output, interaction payload, or SDK environment/credential fields are returned.

Both thread tools set `subagentsRunning` to true when BB's recorded native background-agent count is greater than zero. This flag does not certify process liveness or include arbitrary BB child threads. When the runtime display is `idle` and this flag is true, MCP returns `displayStatus: "active"`. All other runtime display values and the stored `status` stay unchanged. Get uses the final membership-checked thread read. This presentation does not change BB runtime data or foreground controls.

A pending or resolving interaction sets `pendingInteraction` to true and `actionRequired` to `Action required in BB`. Otherwise `actionRequired` is null. Open BB to answer or approve the request. There is no remote approval tool. Status and interaction values are recent observations from separate read calls, not an atomic snapshot.

Both thread tools reject extra fields. Missing, deleted, inaccessible, moved, failed, or oversized thread results return the same MCP tool error, `THREAD_UNAVAILABLE`, with no identifying details. A Personal project request makes no thread SDK call. Disabling remote access or changing the owner denies the next request with an existing token. Authorization and project eligibility are also rechecked after each awaited read. Invalid or unauthorized tokens receive the existing HTTP 401/403 response. An owner removal or disabled listener can close the connection instead. No failure retries or changes BB work.

With an authenticated MCP client, read a listed thread without starting work:

```ts
const page = await client.callTool({
  name: "bb_list_threads",
  arguments: { projectId: "proj_allowed", limit: 10 },
});
const threads = page.structuredContent?.threads as Array<{ id: string }>;
if (!page.isError && threads?.length) {
  const view = await client.callTool({
    name: "bb_get_thread",
    arguments: { projectId: "proj_allowed", threadId: threads[0].id },
  });
  console.log(view.structuredContent);
}
```

Replace `proj_allowed` with a standard project ID returned by `bb_list_projects`. `client` is an already connected official MCP SDK client. This example only reads.

Request and complete response bodies are limited to 64 KiB. A very large project-name page returns a safe error; use a smaller page. The listener permits eight concurrent HTTP requests and eight outstanding BB reads, 120 admitted requests per minute across the endpoint, 32 TCP connections, and a five-second request deadline. It uses one global rate bucket because the external connector hides client IPs; forwarded IPs cannot bypass it. Issuer responses are limited to 32 KiB and three seconds per fetch.

A timed-out read is not retried automatically. BB's project-list API has no cancellation parameter; thread and provider reads receive the request's abort signal. A bounded read can finish later, but its output is discarded. Its read slot stays occupied until it settles. Disable/reload closes transport resources and the listener without calling any thread operation.

Routine rejection logs contain only a generated request ID and fixed safe error code. They omit tokens, request bodies, project names and BB error text.

## Thread starts and operation status

`bb_start_thread` requires `projectId`, a nonblank text `prompt` of at most 32 KiB UTF-8, and an `operationKey`. It accepts an optional nonblank `title` and an optional `providerId`, each at most 200 characters, plus optional `workspace` of `"project-folder"` or `"worktree"`. Keys contain 1 to 128 ASCII letters, digits, `_`, `.`, `:`, or `-`. Extra fields are refused. IDs and title are trimmed. Prompt text is preserved exactly. Normalized input differences, including prompt whitespace or title changes, conflict under the same key.

Bearer tokens need both `bb.read` and `bb.control`. Cloudflare mode needs the explicit local `read-control` app permission. Local remote access and control must be enabled. The target must be a standard project, not BB's built-in Personal project. Every fresh start requires non-null `projects.defaultExecutionOptions`. Without `providerId`, the plugin sends the saved provider, model, permission mode, reasoning level, and service tier unchanged, without reading the provider list.

With `providerId`, the plugin reads the provider list again, including when the selected ID equals the saved provider. The selected provider must exist, be available, and advertise support for the saved permission mode. Unknown, unavailable, or incompatible selections and malformed capabilities fail before dispatch with `START_NOT_DISPATCHED`. The plugin never enables providers, escalates permissions, or falls back. Selecting the saved provider retains all saved execution fields. Selecting a different provider sends only its ID and the saved permission mode. BB resolves that provider's model, reasoning level, and service tier from its catalog defaults. Project defaults remain unchanged.

Without `workspace`, the environment remains `project-default`. Visibility remains `visible`, and plugin attribution and operation metadata remain intact. The plugin rechecks control, token expiry, cancellation, the absolute SDK deadline, and operation ownership after each read and immediately before dispatch. Provider discovery uses the remaining SDK deadline, not a new budget. Other execution overrides, task-board actions, permission responses, and agent-completion waits are not supported.

Omitted and explicit provider selection are distinct requests, even for the saved provider. Changing or removing `providerId` conflicts under the same key. Matching replays do not reread project defaults or providers and do not spawn again. Existing omitted-provider keys retain their original input hash and need no ledger migration.

| `workspace`        | Submitted selection                                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Omitted            | Unchanged `project-default`. BB chooses the environment. This can create a worktree. MCP does not read system config. |
| `"project-folder"` | The project's configured source folder on BB's primary host. No new worktree or branch change is requested.           |
| `"worktree"`       | A new managed worktree on BB's primary host, using BB's default base branch and generated worktree branch name.       |

Explicit modes read `system.config` once for `primaryHostId`, after execution defaults, within the original SDK deadline and request cancellation. BB resolves the project's configured source on that host and validates connectivity, source eligibility and provisioning. The folder is not the MCP process directory or an arbitrary filesystem path. A missing, disconnected or source-less primary host does not select another host. A project configured only on a secondary host cannot use these explicit modes.

The project folder can be shared by other threads or local work. Agents can modify that shared folder under unchanged execution permissions. Folder selection is neither read-only nor isolated. Worktree selection requires a suitable Git source and an available worktree provider. MCP does not accept host IDs, paths, branch names, existing-worktree adoption or environment reuse. Unsupported input is rejected. A BB rejection after spawn remains `unknown`, with no substituted workspace or retry.

With separately approved control, these authenticated client requests select the folder or a new worktree:

```ts
await client.callTool({
  name: "bb_start_thread",
  arguments: {
    projectId: "proj_allowed",
    prompt: "Inspect the existing project folder and report the agreed findings.",
    workspace: "project-folder",
    operationKey: "folder-inspection-1",
  },
});
```

```ts
await client.callTool({
  name: "bb_start_thread",
  arguments: {
    projectId: "proj_allowed",
    prompt: "Implement the agreed change in a new worktree.",
    workspace: "worktree",
    operationKey: "worktree-change-1",
  },
});
```

Both optional selections can be combined independently. Keep both original selections when recovering a lost reply, including omission. Changing, adding or removing either selection under the same key returns `OPERATION_CONFLICT`. Replay observes the original operation without resolving the host, source, providers or execution defaults again, even if configuration changed. Legacy omitted-selection, provider-only and workspace-only keys keep their original hashes without a database migration.

The start result has `operationId`, `state`, `threadId`, `code`, and `meaning`. Start waits up to three seconds for submission, with a total four-second tool-response budget including current thread access checks. Authentication and HTTP processing still have the existing five-second request deadline. A slow access check returns `OPERATION_UNAVAILABLE`; retain the original input/key and inspect BB. `bb_get_operation` takes only `operationId`, requires the selected mode's read permission, and never repeats an action. Status remains available when local control is disabled. Status reads and cached start replies recheck the submitting owner, project eligibility, and current thread membership when a thread ID is known. Missing and disallowed records use the same safe unavailable error.

Old Personal operation records remain in the ledger under the existing retention rules. Remote polling and replay deny them, even when no thread is recorded. Local diagnostics and owner-verified resolution remain available. Exclusion does not delete or redispatch records.

| State      | Meaning                                                                                                                                                          |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pending`  | Submission outcome is still pending. Poll the operation, not agent completion.                                                                                   |
| `accepted` | BB returned acceptance, or the owner recorded verified acceptance locally. The agent has not necessarily started or completed work. BB controls still apply.     |
| `failed`   | An automatic result confirms no dispatch, or the owner locally verified non-acceptance. The code and meaning distinguish these cases. The key remains protected. |
| `unknown`  | Dispatch might have happened. Inspect BB before deciding to submit a new key. This state is never a safe-to-retry promise.                                       |

After a lost reply or transport error, repeat the original input and original key, or poll the known operation ID. A matching key observes the saved operation and does not start again. A changed input returns `OPERATION_CONFLICT`. A disconnect after dispatch does not cancel the BB action. A 30-second SDK deadline marks the outcome unknown; a later reply in the same plugin generation can establish acceptance. Because the public spawn contract does not promise that an error occurs before creation, any spawn error also stays unknown. Raw BB errors are not returned or logged.

SQLite protects the unique issuer/owner/tool/key identity before dispatch with an immediate transaction and FULL synchronous writes. Records contain IDs, an SHA-256 normalized-input hash, timestamps, generation, state, and a fixed safe code. They contain no second prompt, message, title, transcript or token. Operation IDs are also written to the plugin's thread metadata for BB inspection, not authorization. Pending records from a previous generation become unknown on activation and are never resubmitted. The plugin does not keep a durable prompt queue or claim exactly-once BB execution.

Completed `accepted` and `failed` records stay protected for at least 24 hours after their last outcome update. A new claim can remove completed records only after that window. After expiry the same key can create new work, so use unique keys for new actions. `pending` and `unknown` records are never evicted. The ledger holds at most 10,000 records; `LEDGER_FULL` refuses new mutations without a BB mutation. At most eight outstanding submissions and eight operation membership reads run per generation. Slots remain occupied until their SDK calls settle, even after a deadline; `OPERATIONS_BUSY` refuses further new mutations. Existing read-tool and HTTP limits remain unchanged.

Use the [local diagnostics and resolution workflow](#local-diagnostics-and-resolution) to inspect an uncertain action. Never delete the ledger to retry it.

## Follow-up instructions

`bb_send_message` requires only `threadId`, `message`, and `operationKey`. The thread ID is trimmed and bounded to 200 characters. The message must be nonblank and at most 32 KiB UTF-8. Its whitespace stays unchanged. Keys have the same format and retention rules as starts. Extra fields, including project, mode, attachments, scheduling and execution overrides, are refused.

Use a thread ID from a standard-project listing or accepted start. With separately approved control, send the follow-up through an authenticated MCP client:

```ts
const followUp = await client.callTool({
  name: "bb_send_message",
  arguments: {
    threadId: "thr_allowed",
    message: "Run the agreed checks and report the result.",
    operationKey: "follow-up-2026-10-06-1",
  },
});
const operationId = followUp.structuredContent?.operationId;
// Poll bb_get_operation with this ID to inspect submission, not completed work.
```

The selected mode's read/control permissions, the current owner, local control permission and current project membership are required. A direct ID does not bypass project access. Membership is checked before claiming the operation, again before send, and before returning saved results. Status reads remain available with read permission when local control is disabled, but current owner/project/thread access still applies.

The plugin calls only `threads.send` with text input and `mode: "auto"`. BB starts idle input or applies its normal queue/steer behavior during active work. It keeps existing thread execution settings, dispatch hooks, concurrency limits, environment checks and pending approvals. It never approves a request or tries another route after a deferment or rejection. Handle permission decisions in BB.

Send results keep the existing `operationId`, `state`, `threadId`, `code`, and `meaning` fields. They also include `delivery` and `waitingOn`. Existing start results are unchanged.

| Send result                             | Meaning                                                                                                                                                                                                                                                                                                          |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state: "accepted", delivery: "sent"`   | BB accepted the input. This is not completed agent work.                                                                                                                                                                                                                                                         |
| `state: "accepted", delivery: "queued"` | BB retained the input in its queue. It might be waiting or deferred, not running or complete.                                                                                                                                                                                                                    |
| `waitingOn`                             | The saved queue wait kind, such as `thread-busy`, `plugin`, `interaction`, `host-offline`, `provisioning`, `time`, `stopping` or `turn-starting`. Null means BB returned no wait kind. Private queue text, rule reasons and host names are omitted. This is the submission observation, not a live queue status. |
| `pending`                               | The send reply has not arrived. Poll the operation ID. Delivery is null.                                                                                                                                                                                                                                         |
| `failed`                                | Automatic failure means no send was dispatched. Manual resolution means owner-verified non-acceptance. The key remains protected. Delivery is null.                                                                                                                                                              |
| `unknown`                               | Submission might have occurred. Delivery is null. Inspect BB before deciding on a new key.                                                                                                                                                                                                                       |

After a lost reply, use the same normalized thread ID, exact message and original key. A matching key observes the saved result without sending again. A changed message, including whitespace, or changed target conflicts. Start and send have separate tool/key identities. A new intended instruction needs a new unique key. Completed send keys stay protected for at least 24 hours; unresolved keys never expire or replay.

Send uses the same response budget, SDK deadline, durable claim, capacity and generation rules as start. Disconnect after dispatch does not stop work. Any SDK send error stays unknown because the public SDK does not guarantee that errors occur before submission. A later result in the same generation can establish acceptance. Reload preserves outcomes and never resends. The ledger adds only delivery and wait-kind fields, not another message copy. Never delete the ledger to retry uncertain input.

## Stop requests

`bb_stop_thread` accepts only `threadId` and `operationKey`. The ID is trimmed and bounded to 200 characters. Keys use the start/send format and retention rules. Extra fields are refused. The selected mode's read/control permissions, local control, the configured owner and current project membership are required. Access is checked before the durable claim, immediately before stop and before returning saved results. Missing and disallowed threads use the same safe unavailable result.

With separately approved control, request a stop through an authenticated MCP client:

```ts
const stop = await client.callTool({
  name: "bb_stop_thread",
  arguments: { threadId: "thr_allowed", operationKey: "stop-2026-10-06-1" },
});
// Keep this key after a lost reply. Poll bb_get_operation with operationId.
```

The plugin calls only ordinary `threads.stop({ threadId })`. The public SDK returns `{ ok: true }`, not a completion result. `state: "accepted"` and `stopRequested: true` mean BB acknowledged the request. They do not prove that the thread is idle, that its queue is empty or that a permission request was answered. Pending, failed and unknown outcomes have `stopRequested: null`. A confirmed pre-dispatch failure means no stop was dispatched. An SDK error after invocation remains unknown.

Stop replies keep `operationId`, `state`, `threadId`, `code` and `meaning`. They also include `observation`, either null or a saved object with:

- `status`: BB's observed thread status. An active or stopping value does not mean stop completion.
- `queuedMessageCount`: the number of rows returned by the queue read. Queue text and private wait details are omitted.
- `pendingInteraction`: true for a pending or resolving interaction. Handle approvals in BB.

These reads are separate observations, not an atomic or live snapshot. A slow, failed or unauthorized observation read leaves `observation: null` without discarding the stop acknowledgement. Null is not evidence of an empty queue or no pending permission. Use `bb_get_thread` or inspect BB for current state. The ledger adds only these selected observation fields, not queue text, approval payloads or history.

Stopping preserves the thread and its history. It is not queue deletion. Remaining queued input can still need action in BB. This tool cannot delete queue rows or threads, answer permissions, or override execution settings. Closing an MCP connection, closing its listener, disabling remote access or disabling the plugin does not itself stop BB agent work.

Stop shares the absolute response budget, SDK deadline, durable owner/tool/key identity, retention, capacity and restart rules of start/send. Identical retries observe one stop operation; changed targets conflict. Start, send and stop have separate tool/key identities. Disconnects and restarts never replay stops. Keep unresolved keys and inspect BB before deciding on a new key. Local resolution records owner observations only.

## Local diagnostics and resolution

These commands use BB's local plugin CLI. They work with remote access and control disabled. They do not call BB, probe the tunnel, submit work, or answer permissions. No MCP tool can resolve a record. Local CLI access is trusted BB access, not a remote OAuth grant.

```sh
bb mcp operations --limit 20 --json
bb mcp operations --cursor <nextCursor> --limit 20 --json
bb mcp operations --operation <operationId> --json
```

A page contains at most 50 summaries, default 50, and stays below 64 KiB. Long identities can reduce the page size. `nextCursor` is the last returned operation ID, or null at the end. Pages use operation-ID order, not time order or a stable snapshot. Restart pagination after records change. Each summary has the operation ID, original issuer/owner/tool/key identity, project and known thread, state, fixed safe code, creation/update timestamps in epoch milliseconds, `resolvedAt`, and `active`. It omits normalized-input hashes, prompts, messages, titles, output, tokens and raw BB errors. A missing operation returns `OPERATION_NOT_FOUND` locally.

Before resolution:

1. Inspect the summary and record its original identity, target and timestamps. An `active: true` operation can still receive a BB reply, even when its state is unknown. Wait for that reply. A plugin restart marks previous pending records unknown; it never repeats them.
2. Check BB directly. For a start, compare the project's thread history and the plugin's operation-ID metadata when available. For a send, check that exact thread's submitted messages and queue. For a stop, check the target and evidence that BB accepted the stop request. An idle thread alone does not prove which stop request BB accepted. Match the project, thread and time. An absent result alone does not prove rejection.
3. Choose `accepted` only when you verified BB acceptance. For a send, also verify `sent` versus `queued`. Choose `failed` only when you verified that BB did not accept the action. Agent errors after acceptance are not submission failures. Acceptance is not completed agent work; stop acceptance is not confirmed stop completion or queue deletion. Keep the record unknown when the evidence is insufficient.
4. With owner approval for this specific record, save the observation. `--verified` explicitly confirms that the owner checked BB. It is not a check performed by the command.

```sh
# Verified start acceptance. Use the actual IDs from the inspection.
bb mcp resolve-operation <operationId> --outcome accepted --project <projectId> --thread <threadId> --verified --json
# Verified send acceptance. Delivery is required for an accepted send only.
bb mcp resolve-operation <operationId> --outcome accepted --project <projectId> --thread <threadId> --delivery queued --verified --json
# Verified stop acceptance. No delivery or stop-completion override is accepted.
bb mcp resolve-operation <operationId> --outcome accepted --project <projectId> --thread <threadId> --verified --json
# Verified failed start with no known thread.
bb mcp resolve-operation <operationId> --outcome failed --project <projectId> --verified --json
```

All resolutions require the original project. If a thread is already recorded, both accepted and failed resolutions require that same thread. An accepted start requires the verified created thread. A failed start with no known thread cannot add one. Extra flags, invalid outcomes, missing verification, inconsistent targets or delivery, active operations and final records are rejected without changing the record. Resolution uses one immediate SQLite transaction and retains the original identity and input hash. It stores only the selected outcome, target, delivery and resolution time. It saves no notes or content copy. Send wait details and stop observations remain null because resolution did not read BB.

Successful resolution returns the same local summary format. Remote status and identical retries use the existing result fields, with `OWNER_VERIFIED_ACCEPTED` or `OWNER_VERIFIED_FAILED` and a meaning that identifies the local owner observation. Manual failure means verified non-acceptance, not a claim that no SDK call occurred. Automatic pre-dispatch failures keep their existing meaning. The submitting issuer/owner, live project access and known thread membership checks still apply. Removed access cannot read a resolved cached result. Control disable still permits authorized read-only status.

### Retention and cleanup

Unresolved pending and unknown records never expire. Resolution starts a new minimum 24-hour completed-key retention window from its outcome timestamp. During that window, the original key observes the saved result and changed input conflicts. Resolution never makes that key executable. After expiry, a subsequent new claim can remove a completed record, and reusing its key could submit new work. Preserve the original key after transport errors; do not use expiry or a fresh key to test an unknown outcome.

A new unique key is appropriate only for a separately intended action after checking BB and deciding that it will not duplicate existing work. If acceptance is unknown, retain the record and investigate. There is no replay or ledger-reset command. At capacity, new mutations fail safely rather than discard unresolved protection.

For cleanup, preserve the plugin database while unresolved records exist. Completed records can expire through normal claims after their retention window. Disabling or reloading the plugin preserves records and does not stop threads. Disabling remote access, restoring approved temporary settings or revoking an OAuth grant does not remove records. These local commands never change the external Cloudflare tunnel, connector service, DNS or credentials. Infrastructure cleanup remains a separate operator action.

## Local checks and release limits

Use Bun 1.4.3 and Node 24.15 or later within Node 24. From `bb-plugin-mcp`, run:

```sh
bun install --frozen-lockfile
bun run test
bun run typecheck
bun run check:sdk
bun run build
```

Also run repository `bun run check`. CI keeps tests and typecheck independent and runs the same MCP SDK check and build.

`check:sdk` and `build` use the exact locked development pair, SDK `0.6.49` and `bb-app` `0.46.1`. The package-local runner validates installed versions, resolves the builder's declared npm binary, and runs the official `plugin types --check`. Build starts only after that check passes. The runner ignores inherited `BB_CLI`, `BB_CLI_DIR`, `BB_CLI_REEXEC`, and `BB_APP_VERSION`, uses temporary `BB_DATA_DIR` data for the SDK check, and removes that data afterward. It does not run a dependency installer or fall back to a global BB command. Missing or stale dependencies require an explicit frozen install.

The build subprocess uses package-owned `node_modules/.cache/mcp-local-bb` as `BB_DATA_DIR`, never your live BB data. On a cache miss, the official builder downloads its pinned compiler toolchain. Later builds reuse that version-keyed cache. The runner intentionally retains the cache, including after build failures. To remove it, delete `node_modules/.cache/mcp-local-bb`. The next build downloads the toolchain again.

Normal global BB app upgrades do not change this locked development validation. Raw global `bb plugin types . --check` remains an intentional exact SDK freshness check. After a later app upgrade, a pin mismatch can fail that command without proving runtime incompatibility. This workflow does not update or reload a live plugin.

The runtime declarations remain `engines.bb >=0.46` and `engines.bbPluginSdk >=0.6.37 <0.7`. BB checks `engines.bb` with semver. The inspected runtime treats the SDK declaration as a same-major API floor, so `<0.7` is not an enforced runtime ceiling. Local checks do not certify arbitrary future releases or live-host compatibility.

For a deliberate toolchain upgrade, update both exact development pins and regenerate `bun.lock`. Then run the frozen install, tests, typecheck, SDK check, and build above. Verify that `dist/server.meta.json` records the selected SDK and BB versions. Investigate real declaration or behavior failures. Do not suppress them or raise the runtime floor merely to satisfy a freshness check.

The development builder's npm bundle still has dependency advisories. See [the standalone dependency review](VERIFICATION-BBP173.md) for the exact npm override, installed-version evidence, audit limits and bounded build use. A zero lockfile audit alone does not prove that npm's bundled files are patched.

See [the historical BB 0.46 compatibility checkpoint](VERIFICATION-BBP85-BB046.md) for historical SDK/build results and remaining setup gates. The [earlier Cloudflare checkpoint](VERIFICATION-BBP85-CLOUDFLARE.md) preserves the BB 0.45 evidence at commit `6be6aa30fd4fe7e9e7c6887b5380a6cb7df68b7f`; use that revision for BB 0.45. Neither checkpoint is deployment or native acceptance evidence.
See [the BBP-84 local resolution checkpoint](VERIFICATION-BBP84.md), [the BBP-83 stop checkpoint](VERIFICATION-BBP83.md), [the BBP-82 follow-up checkpoint](VERIFICATION-BBP82.md), [the BBP-81 safe-start checkpoint](VERIFICATION-BBP81.md) for fixture-only control evidence and [the BBP-80 checkpoint](VERIFICATION-BBP80-CORRECTION.md) for thread-read evidence and limits, and [VERIFICATION.md](VERIFICATION.md) for the BBP-79 connection checks. No plugin installation, live OAuth account, public tunnel access, or ChatGPT web/mobile test is part of the local test run. These remain unverified. Read-only local MCP results do not establish native mobile support or later control-task acceptance.
