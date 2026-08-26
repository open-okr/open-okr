# P5-T00: the public and external agent surfaces

Part two of the Phase 5 design gate. Authority: AI-NATIVE-PLAN.md §8,
TECHNICAL-PLAN.md §14 and §8, PLAN.md §4. Implemented at P5-T07 (REST, OpenAPI
and the command line), P5-T08 (the authorisation server), P5-T09 (transport,
sessions and the tool catalogue).

## 0. What already exists

| Component | Package | Ships at | What it holds |
|---|---|---|---|
| The action registry | `packages/core` | P1-T07 onward | 250 actions, each with a name, input and output schemas, an access level and a safety class |
| `defineReadAction` / `defineWriteAction` | `packages/core` | P1-T07 | A write is built from an operation spec, so no registry entry can write without the pipeline |
| `can()` and the access getter | `packages/core` | P2-T04 | One authorisation decision, not-found on forbidden |
| `registry.test.ts` invariants | `packages/core` | P2-T04 | No write reachable at `view`; every mutating action runs through the pipeline |
| Better Auth | `apps/web` | P1-T05 | Sessions, accounts, verifications, passkeys, two factors. Session tokens hashed at rest |
| `audit_events` with a hash chain | `packages/db` | P2-T03 | Append-only, verified by `pnpm audit:verify` |

**What does not exist.** No REST surface, no OpenAPI document, no command line.
No `oauth_clients`, `oauth_grants`, `oauth_codes`, `oauth_access_tokens`,
`oauth_refresh_tokens` or `mcp_sessions` table. No MCP transport. The registry
is the one thing all of it is generated from, and it is ready.

## 1. The decision this document exists to make

TECHNICAL-PLAN §14 says every public surface is a **projection** of the action
registry. That word is doing real work, and Phase 5 is where it is tested:
five surfaces (the internal client, REST, OpenAPI, the command line, the MCP
tool catalogue, the chat commands) have to stay in step with one registry
across every future change.

There are two ways to do that and only one of them survives a year.

| Approach | What happens |
|---|---|
| Write each surface by hand against the registry | They agree on the day each is written and drift on the day somebody adds an action |
| Generate each surface, and fail the build when the committed artifact and the regenerated one differ | Drift is a red build with the action's name in it |

**The drift check is the design.** `pnpm gen:contract` regenerates the OpenAPI
document and the command line, and CI compares them against what is committed.
P5-T09 adds the MCP catalogue as a third generated artifact and pins its safety
classifications with an invariant test.

## 2. The three token audiences, and why they cannot be one

| Audience | Issued to | Used at | Lifetime |
|---|---|---|---|
| Session | A person in a browser | The internal API | Better Auth's own, rotating |
| API token | A person or a script | `/api/v1` | Long, revocable, scoped |
| MCP access token | An external agent, on behalf of one person in one workspace | The agent endpoint | Short, refreshed |

**A token for one audience is refused at the others, and that is checked at
issue and on every request.** §8.2 calls this resource binding. The reason it
matters: an API token is a bearer credential somebody pastes into a script and
sometimes into a file; an MCP access token authorises an autonomous agent. If
one worked where the other does, the weakest handling of either becomes the
security of both.

Every secret is stored as a hash with a type prefix, so a leaked database gives
an attacker nothing to present.

**Given** an API token with write scope,
**when** it is presented at the agent endpoint,
**then** the call is refused as unauthorised, and the reverse is refused too.

## 3. REST, OpenAPI and the command line (P5-T07)

### 3.1 The mapping

| Registry field | REST |
|---|---|
| `name` | The path. `goals.create` becomes `POST /api/v1/goals` where the shape is obvious, otherwise `POST /api/v1/actions/goals.create` |
| `safety: "read"` | `GET`, or `POST` where the input is too large for a query string |
| `safety: "write"` | `POST` or `PATCH` |
| `safety: "destructive"` | `DELETE`, and the token needs write scope |
| `input` schema | The request body or the query, and the OpenAPI schema |
| `output` schema | The response body, and the OpenAPI schema |
| `access` | The minimum scope, and `can()` still runs underneath |

**A resource-shaped path where one exists, and a generic one where it does
not.** A registry with 250 actions has plenty that are not CRUD, and forcing
`sessions.revealObjectiveScore` into a noun is how a REST surface becomes
fiction. The generic form is honest and the generator picks it by default.

### 3.2 Pagination, filtering and errors

| Concern | Decision |
|---|---|
| Pagination | Cursor, never offset. A cursor is opaque and encodes the sort key and the id, so a page cannot skip or repeat a row while somebody writes |
| Filtering | One grammar across every list, generated from each action's own input schema. A filter the action does not accept is a 400 naming the field |
| Errors | Typed: `not_found`, `forbidden`, `invalid`, `conflict`, `rate_limited`. `forbidden` is only ever returned for something the caller can see exists |
| Not-found on forbidden | Kept. The REST surface does not become the one place the product confirms a private thing exists |

### 3.3 The command line

Generated from the same registry: one command per action, typed flags from the
input schema, file input for anything rich, and profiles so a person can hold
more than one instance.

Login is a browser device flow, not a pasted token by default. The token it
stores is an API token in the second audience above.

**Given** a change to a registry action's input schema,
**when** CI runs without regenerating,
**then** the drift check fails naming the action, and the message says which
artifact is stale.

## 4. The authorisation server (P5-T08)

### 4.1 Tables

| Table | Key columns | Notes |
|---|---|---|
| `oauth_clients` | `client_id`, `metadata jsonb`, `allow_listed bool`, `registered_at` | Static allow-list plus dynamic registration. Public clients only |
| `oauth_grants` | `member_id`, `workspace_id`, `client_id`, `scopes`, `revoked_at?` | One grant is one person and one workspace |
| `oauth_codes` | `code_hash`, `challenge`, `resource`, `grant_id`, `consumed_at?` | Single use, consumed inside the transaction that issues the token |
| `oauth_access_tokens` | `token_hash`, `grant_id`, `resource`, `expires_at` | Short-lived |
| `oauth_refresh_tokens` | `token_hash`, `grant_id`, `used_at?`, `replaced_by?`, `expires_at` | Rotating, with a lineage |
| `mcp_sessions` | `grant_id`, `protocol_version`, `last_seen_at`, `closed_at?` | The session identifier is bound to the grant |

### 4.2 The flow, and the four places it is easy to get wrong

1. **Authorise.** Sign in, pick a workspace, consent. The workspace picker is
   screen S-40 and it is not optional: a grant with no workspace would make
   every tool schema need a workspace identifier, and §8.1 says they never do.
2. **Code.** Single use, consumed **in the transaction that issues the
   token**. A code checked and then used in a second statement is a code two
   concurrent requests can both spend.
3. **Refresh.** Rotates on every use. Presenting a rotated-away token is not
   an error to shrug at: it means the token leaked, so **the whole lineage is
   revoked** and the person is told in their connections list.
4. **Resource binding.** Validated at issue and again on every request, which
   is what keeps §2's three audiences apart.

Client metadata fetches go through the outbound-request rules: no redirects to
private addresses, a timeout, a size cap. Native redirect rules are enforced,
custom schemes only to the callback path, dangerous schemes denied, and
transport security required in production.

**Given** an external client that completes the flow and later presents a
refresh token that has already been rotated away,
**when** the token endpoint receives it,
**then** every token in that lineage is revoked, the grant is marked revoked,
and the person sees it in their connections list with the time it happened.

### 4.3 Revocation on membership loss

A grant is one person in one workspace. Losing membership, or being suspended,
invalidates it **on the next call** rather than by a sweep: the member and
their status are revalidated per request, which is the same rule
`resolveActor` already applies everywhere else. A sweep would leave a window;
per-request revalidation has none.

## 5. Transport, sessions and tools (P5-T09)

### 5.1 Two transports, one authorisation model

| Transport | Who uses it | Authentication |
|---|---|---|
| Streamable HTTP | Hosted agent clients | OAuth 2.1 with PKCE, the flow above |
| Standard input and output | Local or air-gapped desktop agents | A scoped token, because there is no browser to redirect |

**The MCP server makes no outbound AI calls of its own.** That is what makes it
air-gap safe by construction, and it is a property to protect rather than a
coincidence: a tool that called a provider would put an egress in the one
surface whose selling point is that it has none.

### 5.2 The tool catalogue

Generated from the registry. Each tool carries:

| Field | From |
|---|---|
| name, description | The action's `name` and `summary` |
| input schema | The action's `input`, unchanged |
| read-only or destructive hint | The action's `safety` |
| required scope | The action's `access` |
| examples | Hand-written per action, because a generated example is a lie about what people do |

**Lifecycle and destructive actions are included.** Hiding them would not make
an agent safer; it would make the agent's user do the same thing by hand with
less oversight. What makes them safe is that `can()` runs, the token needs
write scope, and every call writes a tool-call row and an audit event.

A catalogue invariant test pins every tool's safety classification, so an
action that loses its `destructive` class fails the build rather than quietly
becoming something an agent may call without write scope.

### 5.3 The two tools that are not registry actions

| Tool | Why it is special |
|---|---|
| `search` | A global, permission-filtered search across everything. It is one tool rather than fifteen list tools, because that is how research connectors expect to work |
| `fetch` | Turns a canonical OpenOKR URL into structured content with a citation. Same access filter as any read |

Both go through the same access layer as everything else. `search` is P5-T13's
own read with a tool wrapper, and `fetch` resolves a URL to the action that
would have served that page.

**Given** an external agent holding read scope,
**when** it calls a write tool,
**then** the permission layer denies it, the denial is audited, and the agent
receives a clear error rather than a partial result.

### 5.4 What the live test proves

§10's own words: the claim that every call is permission-checked is
machine-verified, not asserted. P5-T09's test drives the real authorisation and
transport stack end to end and asserts two things:

1. An under-privileged call is denied by the permission layer, not by the tool
   list being filtered.
2. No cross-tenant data appears in any result, checked by running two
   workspaces and asserting the second's identifiers never appear in the
   first's responses.

## 6. Sequencing

P5-T07 before P5-T08 before P5-T09, and the reason is not preference. The
OpenAPI generator and the tool catalogue are the same projection with two
renderings, so building REST first means the catalogue is a second output of a
generator that already works rather than a parallel implementation of it.

## 7. Open questions for the human

| # | Question | My position |
|---|---|---|
| A1 | Resource-shaped REST paths, or generic `actions/<name>` for everything? | Both, with the generator choosing. A pure generic surface is honest and unpleasant; a pure resource surface is a lie for a third of the registry |
| A2 | Does the command line ship with the product or as a separate package? | The same repository, published separately. It is generated, so it cannot drift, and a separate install is what people expect |
| A3 | Are API tokens per member or per workspace? | Per member, always. A workspace token is an ambient authority with no accountable person, which is the thing CLAUDE.md's agent rules exist to prevent |
| A4 | Rate limits: per token, per member, or both? | Both, with the tighter one applying. A person with five tokens is still one person |
