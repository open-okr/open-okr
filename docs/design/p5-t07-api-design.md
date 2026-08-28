# P5-T07: the public contract projections

Written at P5-T07a, covering all three parts. TECHNICAL-PLAN.md §14 is the
authority; where this document reads §14 in a particular way, it says so and
says why.

| Part | What it delivers | State |
|---|---|---|
| P5-T07a | The REST surface, its tokens, the typed errors, paging | built |
| P5-T07b | The OpenAPI document, `pnpm gen:contract`, the drift check | built |
| P5-T07c | The command line, profiles, the browser device login | not started |

## 1. The shape of the surface

Everything public is a projection of the action registry. Nothing is written
twice.

| Property | Derived from | Example |
|---|---|---|
| Path | the action's name, dots to slashes | `goals.list` → `/api/v1/goals/list` |
| Method | the safety class | read → `GET`, write and destructive → `POST` |
| Scope | the safety class | `read`, `write`, `destructive` |
| Parameters | the input schema's own keys | `goals.list` → `cycleId`, `level`, … |
| Paging | the action's `page` declaration | `activities.workspaceFeed` |

Two decisions inside that table are worth stating plainly.

**The path is the action's name, not a resource.** A resource-shaped surface
(`GET /api/v1/goals/{id}`, `PATCH /api/v1/goals/{id}`) would need a
hand-written mapping from three hundred actions onto nouns and verbs. That
mapping is the thing that goes stale, and it would be a second registry with no
test able to prove it complete. The action-named path reads as REST, is
completely generated, and a client that can read `GET /api/v1` can reach
everything.

**The method is a safety property, not a style.** A GET is retried by proxies,
prefetched by browsers and cached by anything in between. Deriving the method
from the safety class means a write can never be reachable by GET, and a
mismatch answers 405 rather than doing the work.

## 2. Filtering: a deliberate reading of §14

§14 asks for "a filter grammar matching the list contracts". This implements the
second half of that phrase and not a separate syntax, and that is a choice
rather than an omission.

The list contracts already express their filters as declared, typed,
individually documented input fields. `goals.list` takes `cycleId`,
`includeClosed`, `level`, `spaceId`, `health` and `mine`, each with a schema and
each enforced by the action. Layering `?filter=field:op:value` over that would
mean:

- a parser and its own refusals, for a vocabulary in which only `eq` has a
  consumer today, because no list action accepts a range or a set;
- two ways for a caller to ask the same question, with two chances to disagree;
- a transport that knows which fields are filterable, which is a second
  declaration beside the schema.

So the filter grammar is the declared input, projected as query parameters. The
part that makes it a contract rather than a coincidence is the refusal: a
parameter the action does not declare is answered `unsupported_parameter` with
its name and the list of what the action does take, rather than dropped. Silent
dropping is how somebody spends an afternoon on `?spaceID=` deciding the filter
is broken.

If a list action later grows a genuine range or set filter, it grows it as an
input field with a schema, and this surface projects it with no change here.

## 3. Paging

Declared per action, never faked in the transport.

```ts
page: { cursorFrom: ["at", "id"] }   // activities.workspaceFeed
```

| Behaviour | Rule |
|---|---|
| Cursor in | decoded from base64url and handed to the action, which validates it with its own schema |
| Cursor out | built from the last returned item's declared fields, or null |
| An action with no declaration | `?cursor=` is refused by name |
| A short page | the last page; this surface does not know the action's limit |

Loading everything and slicing it in the transport would cost the same query and
tell the caller it had not. So an action that cannot page says so.

Only `activities.workspaceFeed` declares paging today, because it is the only
registry action that already takes a cursor. Every other list returns its whole
result, which is what the browser reads. Adding paging to a list is a change to
that list's query, and belongs to the task that needs it.

## 4. Tokens

| Property | Decision | Why |
|---|---|---|
| Storage | SHA-256 digest, shown once | A stolen row is not a credential |
| Audience | a column, `rest` or `mcp` | §14: separate audiences. A caller's string is not evidence |
| Prefix | `okr_rest_` / `okr_mcp_`, 16 characters kept | Tell two of your own apart; refuse the wrong door without a query |
| Scopes | the registry's three safety classes | One vocabulary, so the check is set membership |
| Access level | none | A token carries its minting member's authority; `can()` still decides |
| Expiry | optional, in days | Nothing has to run for an expired token to stop working |
| Revocation | `revoked_at`, row kept | "You revoked that on Tuesday" beats a row that vanished |
| Suspension | resolved live | A suspended member's tokens stop working with nothing revoked |

**There is no service account.** A token is a person, narrowed. That is what
makes it safe for any member to mint one without an administrator, and it is why
a write-scoped token in a view-level member's hands still writes nothing.

**The pre-tenant lookup.** A request carries a token and nothing else, so the
lookup runs before a workspace is known and forced row-level security would
otherwise answer with nothing. `api_tokens` takes a second policy key,
`app.api_token_hash`, set only by `withApiToken`, admitting exactly the row whose
digest the caller already holds. This is the arrangement `channel_installations`
uses (P5-T02a) for the same reason, and `app.user_id` on `workspace_members`
before that.

## 5. Errors

A closed enumeration, so a client branches on a code rather than on prose.

| Code | Status | Raised when |
|---|---|---|
| `unauthenticated` | 401 | No token, or one that does not resolve |
| `insufficient_scope` | 403 | A resolving token whose scopes miss this action's |
| `forbidden` | 403 | Visible, but below the level the action needs |
| `not_found` | 404 | No such row, or one the reader cannot see |
| `unknown_action` | 404 | No action at that path |
| `method_not_allowed` | 405 | A read by POST, or a write by GET |
| `invalid_input` | 422 | The action's schema refused it; `fields` says where |
| `unsupported_parameter` | 400 | A parameter or cursor the action does not declare |
| `rate_limited` | 429 | More than 600 requests a minute on one token |
| `internal` | 500 | Anything unrecognised, described in no further detail |

**Forbidden has already collapsed by the time the transport sees it.** §14 says
forbidden collapses to not-found for invisible resources; that happens in `can()`
and the access getter, so the transport never holds the information that could
leak. What arrives as `forbidden` is the other case, a resource the reader can
see at an insufficient level, and flattening that would be a lie in the other
direction.

## 6. The order of a request

Not rearrangeable.

1. Read the bearer token. No token, 401.
2. Resolve it: digest, revocation, expiry, audience, membership.
3. Rate limit, per token.
4. Route. Unknown, 404.
5. Method. Mismatch, 405.
6. Scope. Missing, 403, before the action runs.
7. Input: query parameters for a read, a JSON body for a write.
8. `callAction`, with `channel: "api"` so every write's audit row names the door.

Routing before authenticating would let anyone with a network path enumerate
which actions an instance has, one 404 at a time. Checking the scope after
running the action would be checking it too late, and the end-to-end spec asserts
exactly that by sending a write whose body is incomplete: a scope refusal that
ran second would answer 422 about the fields instead of 403 about the scope.

## 6b. The document and the drift check (P5-T07b)

The document is built by the same `REST_ROUTES` the transport serves, so it
cannot describe an action the surface does not have or miss one it does.

| Piece | Where it comes from |
|---|---|
| Path, method, operation id | the route, which comes from the action's name and safety class |
| Query parameters | the input schema's own properties, one parameter each |
| Request body | the input schema, for a write |
| Response `data` | the output schema |
| `x-openokr-scope`, `x-openokr-safety` | the registry's declared safety class |
| Errors | the typed enumeration, declared once under `components.responses` |

The schemas are the actions' own Zod schemas through `z.toJSONSchema`, which
emits JSON Schema 2020-12, the dialect OpenAPI 3.1 uses. No shape is described
twice anywhere.

**One script in two modes.** `pnpm gen:contract` writes `contract/openapi.json`
and `pnpm check:contract` compares a fresh document against it. A separate
generator and checker are two programs that can disagree about what the artifact
should be, and then the check passes on a file the generator would never write.

**The failure names the action.** A byte difference is the trigger; the message
is a per-action diff, so a stale document reports `changed: goals.create` rather
than a JSON path. A change outside `paths` is reported against the document
itself, which is rare and worth saying plainly.

**The artifact is committed** so a change to the public surface appears in a diff
a person reviews. That is the point of the gate: not to catch a broken
generator, but to make a contract change impossible to ship silently. The error
responses are shared through `$ref` for the same reason, which took half a
megabyte of repeated boilerplate out of the file.

**The served document is generated, not read from the artifact.**
`GET /api/v1/openapi.json` calls the same builder, so it describes the running
instance whatever version it is on, and the committed copy is kept honest by the
gate rather than by being the source.

## 7. Acceptance criteria

### P5-T07a

**Given** a token minted with read scope only, **when** it is presented to any
write action on the versioned surface, **then** the call is refused for scope
before the action runs, and the refusal names the scope it needed.

Proved in `e2e/s37-api-tokens.spec.ts`, over HTTP, with the absence of the write
asserted afterwards through a read the same token can do.

### P5-T07b

**Given** a change to a registry action's schema, **when** continuous integration
runs without regenerating, **then** the drift check fails naming the action.

### P5-T07c

**Given** a signed-out terminal, **when** a person runs the device login and
completes it in the browser, **then** the profile holds a scoped token and the
next command runs as them.

## 8. Found while building this

**The proxy gated both self-authenticating surfaces.** `apps/web/proxy.ts`
redirects any request with no session cookie to `/sign-in`. The REST surface
authenticates a bearer token, and the inbound channel webhooks verify a provider
signature over the raw bytes; neither sends a cookie. Before P5-T07a, every
inbound Slack and Telegram request was answered with a 307 to the sign-in page,
so nothing the channel layer does could ever have run in a deployed instance.
The unit tests call the handler function directly and could not see it. Both
prefixes are now on the public list, with a test, and the reason is written on
the list rather than in a commit message.

**Ten spec files signed in as the same person.** Better Auth allows ten
sign-ins per address per minute (P2-T09), the end-to-end suite runs
single-worker as one account, and this task's spec was the tenth. The failure
lands on whichever file happens to be running when the limit trips, which is how
it read as flakiness in `sessions.spec.ts` on two separate occasions.
`e2e/instance-account.ts` now authenticates once and restores the cookies for
every later spec, which is what a browser does anyway, and leaves the limit to
be exercised by the specs that are about it.
