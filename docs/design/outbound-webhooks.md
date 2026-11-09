# Outbound webhooks

Status: proposed 9 November 2026 for release 0.7.0 (plan D5), waiting for "design approved". A new subsystem with two new tables and a new way data leaves the workspace, so it is designed first (CLAUDE.md).

Authority: TECHNICAL-PLAN §14 ("Webhooks. Outbound, signed per hook, validated against the outbound-request rules, delivering the same summary shapes, with delivery logs"), §11's outbound-request row, and §13.2 ("Every resource declares a summary shape").

## 0. What exists

| Piece | Where | Today |
|---|---|---|
| The rule | TECHNICAL-PLAN §14 | One line. REQUIREMENTS and UIUX-PLAN say nothing about webhooks |
| Inbound webhooks | Channels, billing | Built, signature-verified. Nothing goes out |
| The outbound guard | `outboundFetch`, `packages/adapters/src/outbound/guard.ts` | Every resolved address checked, private and metadata ranges blocked, no redirects, size and time capped |
| The outbox | `packages/adapters/src/relay.ts`, `packages/core/src/outbox/handlers.ts` | Retries with backoff, dead letters, per-workspace fairness and the rate hold (P6/P7) |
| Activity rows | `packages/core/src/activities/catalogue.ts` | Every write records a typed kind with its subject |
| Summary shapes | Each list action's output schema | The shape REST and the agent tools already return |
| Agent surface flag | `agentSurface` on a registry route | An action marked off it is not a tool at all |

## 1. Decisions

| # | Decision | Why |
|---|---|---|
| W1 | **A hook is a URL, a set of events and an owner.** An administrator creates it; it acts as that administrator. Each delivery reads its subject through the access getter as the owner, at the moment it is sent. A subject the owner can no longer see is not sent, and the log says "withheld" | A webhook is a way data leaves the workspace, so it gets the same object authorisation as every other read. No hook has more reach than a person |
| W2 | **A suspended or removed owner pauses the hook**, as it ends an agent token. Another administrator may take it over, which makes them the owner and is audited | No hook outlives the person whose access it borrows |
| W3 | **A fixed, public event catalogue**, named for receivers and versioned, mapped from activity kinds in one table in `packages/core/src/webhooks/events.ts`. 0.7.0's catalogue is below (§2). A receiver never sees an internal activity kind | Internal kinds are renamed and split as the product changes. A receiver's integration must not break when they do |
| W4 | **The body is the summary shape** of the subject, from the same output schema the list action returns, inside an envelope: `{ id, type, occurredAt, workspace, data }`. A deleted subject sends `data: null` with `deleted: true` | §14 says "the same summary shapes". One shape for REST, agents and hooks |
| W5 | **Signed per hook, the Standard Webhooks way**: headers `webhook-id`, `webhook-timestamp` and `webhook-signature: v1,<base64 HMAC-SHA256 of id.timestamp.body>`. A secret of 32 random bytes, `whsec_` and base64, shown once when the hook is made or rotated. Rotation keeps the old secret signing beside the new one for 24 hours | A published scheme receivers already have libraries for, written by hand with `node:crypto`, so no dependency. The overlap lets a receiver change its secret without dropping a delivery |
| W6 | **The secret is envelope-encrypted**, as channel credentials are, because the server must sign with it and so cannot hash it. Never logged, never read back on any screen or output | CLAUDE.md: credentials are envelope-encrypted and decrypted server-side only |
| W7 | **Every request goes through `outboundFetch`**: HTTPS only, every resolved address checked, no redirects, a 10 second limit, the response body read up to 64 KB and discarded. A 2xx answer is delivered; anything else is a failure | §14 says "validated against the outbound-request rules". A hook URL is exactly the server-side request forgery the guard exists for |
| W8 | **Delivery through the outbox.** The Operation that writes a mapped activity also inserts one `webhooks.deliver` outbox row per active hook subscribed to that event, in the same transaction. The relay's retries, backoff, dead letters, fairness and rate hold then apply as they do to everything else | Side effects are enqueued only by an outbox row in the write's transaction (CLAUDE.md). A workspace with no hook pays one indexed lookup on a tiny table |
| W9 | **Retries over about a day, then off.** The relay retries with its backoff for 24 hours. A hook whose last 50 deliveries all failed is turned off, its creator is told by email, and the screen says why. Turning it back on is one click | A receiver that is down for a weekend should not be hammered for it, and somebody should know |
| W10 | **The delivery log keeps the facts, not the body.** One row per attempt: the event, the subject, when, the status code, the duration, the attempt number, and a refusal reason in our own words. No request or response body, no response header. Kept 30 days, purged daily | The body is workspace content and the answer is whatever the receiver says. Neither belongs in a log. A redelivery reads the subject again (W1) |
| W11 | **Managing hooks is an administrator's**: the `workspace` role domain at its admin level. A screen at `/admin/webhooks`, a section of workspace admin | Like channels, a hook sends workspace events out |
| W12 | **Registry actions, off the agent surface**: `webhooks.list`, `webhooks.create`, `webhooks.update`, `webhooks.rotateSecret`, `webhooks.remove`, `webhooks.test` (sends a `ping` event), `webhooks.deliveries`, `webhooks.redeliver`. REST and the command line get them; no agent toolset does | An agent that could create a hook could build its own way out of the workspace. That is an autonomy raise, which is Akmal's to make (CLAUDE.md), so it is not made here |
| W13 | **Two tables, both tenant-scoped with row-level security in the same migration.** `webhooks` (soft-deleted) and `webhook_deliveries` (no `deleted_at`: purged by age, `openokr:hard-delete`). TECHNICAL-PLAN §7.2 marks both "no legacy source" | Every business table carries `workspace_id` and its policy. FlowyTeam's own webhooks have no secret we could carry and point at FlowyTeam's payloads, so importing them would send a receiver bodies it cannot read |
| W14 | **The workspace archive carries hooks without their secrets**, imported turned off, so an administrator rotates each secret before turning one on | A moved archive must not start sending to somebody's URL by itself, and a secret never travels |

## 2. The 0.7.0 event catalogue

| Event | From the activity kinds | Subject's summary |
|---|---|---|
| `objective.created`, `objective.updated`, `objective.published`, `objective.closed`, `objective.deleted` | goal kinds at the objective level | `goals.list` row |
| `key_result.checked_in` | check-in recorded on a key result | `goals.list` row of the key result, with the check-in's value, confidence and note excerpt |
| `kpi.recorded` | KPI record added | `kpis.list` row |
| `initiative.created`, `initiative.updated`, `initiative.completed` | initiative kinds | `initiatives.list` row |
| `task.created`, `task.completed` | task kinds | `tasks.list` row |
| `cycle.phase_changed` | cycle status and phase changes, including closing (O2) | `cycles.list` row |
| `ping` | `webhooks.test` only | `{}` |

Adding an event later is additive. Renaming or removing one follows PLAN §5.1's two releases.

## 3. The screen

`/admin/webhooks`, in the workspace admin section navigation.

| Part | What it shows |
|---|---|
| List | Each hook's name, URL host, events, owner, state (on, paused by the owner's suspension, turned off after failures), and its last delivery's result and time |
| Create | Name, URL, events (grouped checkboxes), optionally one space to limit it to. On save the secret shows once with a copy control and the line "You will not see this again" |
| A hook | Its settings, Rotate secret (asks first, shows the new secret once), Send test, Turn off or on, Remove (asks first) |
| Deliveries | The last 30 days, newest first: event, subject, status, duration, attempt, and Redeliver on a failed one |
| States | Loading, empty ("No webhooks yet" with what one does), error, and permission-denied for a member below the admin level |

All of it works with AI off; nothing here uses AI.

## 4. Questions for Akmal

**Q1. A hook to a private address on a self-hosted instance?** The outbound guard refuses private ranges, so an air-gapped install cannot send to its own intranet. Proposed: **an instance setting `webhooks.allowPrivateTargets`**, off by default, environment `OPENOKR_WEBHOOKS_ALLOW_PRIVATE`, not shown on a managed cloud, where it is always off. The metadata ranges stay blocked either way.

**Q2. The 0.7.0 event catalogue in §2: enough, too much?** Proposed: **as listed**, the events an integration most asks for (a goal changed, a check-in landed, a KPI moved, a cycle turned). Everything else waits for somebody to ask.

**Q3. Keep hooks off the agent surface (W12)?** Proposed: **yes, off**. Turning them on would let an agent build its own way out, which CLAUDE.md lists as an autonomy decision.

## 5. Acceptance criteria

- Given an administrator creates a hook for `key_result.checked_in`, when a member checks in a key result the owner can see, then one signed POST arrives with the key result's summary, and a delivery row records 200.
- Given the same hook, when a member checks in a key result in a private space the owner is not in, then nothing is sent and the log says "withheld".
- Given a hook whose URL resolves to a private or metadata address, when it is saved, then it is refused with the guard's reason; and when the name later resolves there, then the delivery is refused and logged, never sent.
- Given a receiver that answers 500, then the relay retries with backoff for a day; given 50 failures in a row, then the hook turns off, its creator receives one email, and the screen says why.
- Given a rotated secret, when a delivery is sent within 24 hours, then it carries two `v1` signatures, one per secret.
- Given the hook's owner is suspended, when a mapped event happens, then no outbox row is written and the hook shows paused.
- Given an agent token, when it lists its tools, then no `webhooks.*` tool is offered.
- Given a workspace with no hooks, when a goal is written, then no `webhooks.deliver` outbox row exists.
- Given a delivery row older than 30 days, when the daily purge runs, then it is gone.

## 6. Tests

| Kind | File | Covers |
|---|---|---|
| Unit | `packages/core/test/webhook-signature.test.ts` | The Standard Webhooks signature against the scheme's published test vector, two signatures during rotation |
| Unit | `packages/core/test/webhook-events.test.ts` | Every catalogue event maps from a registered activity kind, and every mapped kind has an event |
| Integration | `packages/core/test/webhooks.test.ts` | Create, the secret shown once, the outbox rows per subscribed hook, withheld, paused owner, turned off after failures, redeliver, purge |
| Integration | `packages/core/test/webhook-delivery.test.ts` | The handler through a fake `outboundFetch`: 2xx, 5xx, refusal, the headers |
| Integration | `packages/db/test/rls.test.ts` (existing) | Both tables behind the tenant floor |
| Contract | `pnpm check:contract` | The eight actions in REST and the command line, none in `contract/mcp.json` |
| Browser | `e2e/s36s-webhooks.spec.ts` | Create a hook pointed at a local receiver the spec runs (the server started with `OPENOKR_WEBHOOKS_ALLOW_PRIVATE=1`, Q1), see the secret once, send a test, see the delivery |

## 7. What this does not do

- No inbound actions through a hook: receivers act through REST with a token.
- No per-field filters or payload templates.
- No hook for an agent or for a single member's own events.
- No delivery body kept for replay; a redelivery reads the subject again.
