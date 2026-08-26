# P5-T00: the channel design

Part one of the Phase 5 design gate. Authority: AI-NATIVE-PLAN.md §5,
TECHNICAL-PLAN.md §4.11 and §5, METHOD.md §11. Implemented at P5-T01 (port,
email, routing), P5-T02 to P5-T05 (the four providers), P5-T06 (the command
surface).

## 0. What already exists

| Component | Package | Ships at | What it holds |
|---|---|---|---|
| `Channel` port | `packages/adapters` | P2-T05 | `send`, `sendToChannel`, `verifyInbound`, `parseInbound`, `capabilities`, `stop` |
| `NoneChannel` driver | `packages/adapters` | P2-T05 | The off driver. Suppresses every send with a reason, never throws |
| `notification_settings` | `packages/db` | P2-T06 | Per-reason routing, `batch_window_minutes`, `daily_summary_time`, `quiet_hours jsonb` |
| `notification_batches` | `packages/db` | P2-T06 | Per-member coalescing under a row lock |
| `notifications` | `packages/db` | P2-T06 | One row per recipient, with `channel` and `sent_at` |
| `nudges`, `nudge_rules` | `packages/db` | P4-T04a | Every proactive message, with `rule_key`, `channel`, `escalation_step`, `suppressed_reason` |
| Nudge engine | `packages/core` | P4-T04a to c | Deduplication, quiet hours, the escalation ladder, the volume ceiling |
| Mail port and driver | `packages/adapters` | P1-T06 | SMTP send. Used today for invitations only |

**What does not exist.** No `channel_connections`, `channel_identities` or
`channel_messages` table. No driver but `none`. Every nudge is written with
`channel: "in_app"`, and `nudges/service.ts` already carries the comment saying
the member's own channel is resolved at delivery. Phase 5 is where delivery
arrives.

## 1. The decision this document exists to make

The port is built and the engine is built. What is missing is the layer between
them, and it has one hard question in it: **a nudge is written in a transaction,
and a provider call is a network round trip that can fail, retry and duplicate.**

The answer is the same one the rest of the product already uses. A nudge write
enqueues an outbox row. A relay picks it up, resolves the channel, calls the
driver and records the outcome in `channel_messages`. Nothing about delivery
happens inside the transaction that decided to nudge.

That has a consequence worth stating plainly: **Phase 5's channel work does not
deliver anything until a host consumes the outbox** (PLAN.md §12, R10). The
tables, the drivers, the routing and the command surface are all testable
without one, and none of them sends a message in a running instance until the
relay exists.

## 2. Tables

Three, exactly as TECHNICAL-PLAN §4.11 lists them. Every one carries
`workspace_id` and a row-level security policy in the same migration.

### 2.1 `channel_connections`

| Column | Type | Notes |
|---|---|---|
| `provider` | `slack` / `teams` / `whatsapp` / `telegram` | Email needs no connection: it is the instance's mail settings |
| `state` | `connected` / `error` / `disabled` | `error` is a connection that verified once and stopped working |
| `credentials_ciphertext`, `data_key`, `key_id` | text | Envelope-encrypted, the same shape `ai_credentials` uses |
| `config` | `jsonb` | Provider-specific: team id, tenant id, phone number id, bot username |
| `installed_by_id` | member | Who connected it, for the audit trail |
| `last_verified_at` | timestamptz | Set by the verify call, not by the install |

Unique on `(workspace_id, provider)`. One connection per provider per
workspace, which is what §5.1 says and what makes routing a lookup rather than
a choice.

### 2.2 `channel_identities`

| Column | Type | Notes |
|---|---|---|
| `member_id` | member | Whose identity it is |
| `provider` | the four | |
| `external_id` | text | The provider's own identifier for that person |
| `external_handle` | text? | For display. Never used for resolution |
| `verified_at` | timestamptz? | Null until the member proved it |

Unique on `(workspace_id, provider, external_id)` **and** on
`(workspace_id, provider, member_id)`. Both directions: one person is one
identity per provider, and one provider identity is one person.

**Resolution is by `external_id` and never by handle.** A handle is
changeable, reusable and sometimes shared. An inbound message from an
unverified or unknown identity is discarded before it is parsed.

### 2.3 `channel_messages`

| Column | Type | Notes |
|---|---|---|
| `provider`, `direction` | text | `out` or `in` |
| `member_id` | member? | Null for a channel post with no single recipient |
| `external_thread_id` | text? | For threading a reply onto its own conversation |
| `payload` | `jsonb` | What was sent or received, after verification |
| `idempotency_key` | text | Unique per workspace. The relay's safety net |
| `status` | `queued` / `sent` / `failed` / `suppressed` | |
| `error` | text? | The provider's own message, for the connection health card |

Unique on `(workspace_id, idempotency_key)`. **This is what makes a relay retry
safe**: the second attempt finds the row and stops.

## 3. Routing

One function, `resolveDelivery`, in `packages/core`. Pure apart from the reads
it needs, so the decision is testable without a provider.

```
member + nudge kind + now
  -> { channel, sendAt, suppressedReason? }
```

The order it decides in, which is §5.4's own order:

| Step | Rule | Outcome when it applies |
|---|---|---|
| 1 | The workspace is in quiet mode and the nudge is not an escalation | Suppressed, reason `workspace_quiet_mode` |
| 2 | The member has a verified identity on their primary channel | That channel |
| 3 | No verified identity, or the provider is disconnected | Email, plus in-app |
| 4 | The chosen channel is inside the member's quiet hours | Queued to the next open window |
| 5 | The nudge is an escalation the workspace marked urgent | Sent inside quiet hours anyway |

**In-app is never routed away.** A notification row is written whatever the
channel decides, because §5.4's last line is that snoozing never silences the
review inbox. The channel is where the product goes to find them; the product
is where the obligation lives.

### 3.1 Failure and the one-time notice

A send that fails writes `channel_messages.status = 'failed'` with the
provider's error, and the relay retries the delivery through email. The member
is told **once** that their channel needs reconnecting, using the nudge
engine's own deduplication: the notice is a nudge with its own rule key, so it
deduplicates per member per day like everything else rather than arriving with
every failed send.

**Given** a member whose Slack identity has been deactivated,
**when** their check-in nudge is delivered,
**then** it arrives by email, `channel_messages` holds one failed row with
Slack's own error, and they receive exactly one notice that their channel needs
reconnecting however many nudges fail that day.

## 4. The capability matrix

§5.2's table, as `capabilities()` returns it. The message builder reads this
and degrades; no driver refuses a message it cannot render.

| Provider | outbound | inbound | richCards | buttons | threads | templateOnlyOutbound |
|---|---|---|---|---|---|---|
| Email | yes | no | no | yes, as links | no | no |
| Slack | yes | yes | yes | yes | yes | no |
| Teams | yes | yes | yes | yes | no | no |
| WhatsApp | yes | yes | no | no | no | **yes, outside the window** |
| Telegram | yes | yes | no | yes, inline | no | no |

**Degradation is one direction and it is always the same.** A message is built
once, as text plus optional blocks plus optional buttons. A provider without
`richCards` gets the text. A provider without `buttons` gets the text with the
links appended. A provider with `templateOnlyOutbound` outside its window gets
the registered template for that nudge kind, and the free-form body is dropped
rather than sent as a second message.

**Given** a nudge with three action buttons,
**when** it is delivered to Telegram and to WhatsApp outside the window,
**then** Telegram shows an inline keyboard with three buttons, WhatsApp shows
the approved template for that nudge kind, and neither driver raises an error.

## 5. Identity linking

One flow, four providers, and it is deliberately dull.

1. The member opens their own settings and picks a provider.
2. The product issues a short code, valid for ten minutes, single use, stored
   hashed.
3. The member sends that code to the bot, or clicks the provider's own
   authorise link where the provider has one.
4. The inbound handler verifies the signature, finds the code, writes
   `channel_identities` with `verified_at`, and discards the code.

**An unlinked sender receives nothing at all.** §5.3 says so and the reason is
in the sentence: a helpful error confirms the workspace exists. The inbound
handler's first branch is "is this identity known and verified", and the
answer no ends the request with a 200 and no reply.

## 6. Inbound security

Every inbound request, in this order, before anything reads the body as data:

| Step | Check | On failure |
|---|---|---|
| 1 | Signature over the raw bytes, per provider | 401, nothing parsed |
| 2 | Timestamp inside the replay window | 401 |
| 3 | The delivery id has not been seen | 200, ignored as a duplicate |
| 4 | The sender resolves to a verified identity | 200, no reply |
| 5 | The member is active and not suspended | 200, no reply |
| 6 | Rate limit for that member and provider | A plain message, because they are linked |
| 7 | The command resolves to a registry action | A plain message naming what is available |
| 8 | `can()` on that action | The same refusal the browser shows |

Steps 1 and 2 read the raw body. **The parsed object is never trusted before
its bytes are verified**, which is why `verifyInbound` takes `rawBody` and
`parseInbound` is a separate call.

Retrieved and inbound content is untrusted throughout. A chat message that
contains something that looks like an instruction is a string in a payload,
never a prompt.

**Given** a Slack payload with a valid body and a tampered signature,
**when** it arrives,
**then** it is refused before parsing, nothing is written, and the response
carries no detail about why.

## 7. The command surface

One router, generated from the action registry, in `packages/core`. §5.3's
seven commands, each mapping to exactly one registry action:

| Command | Registry action | Access it needs |
|---|---|---|
| check in | `goals.startCheckIn` then `goals.publishCheckIn` | edit on the goal |
| blocker | `sessions.createBlocker` | edit |
| status | `goals.read` / `kpis.detail` / `notifications.list` | view |
| ack | `goals.acknowledgeCheckIn` | edit |
| commit | `sessions.setCommitments` | edit |
| ask | `copilot.ask` then `answerQuestion` | comment |
| snooze | `nudges.snooze` | comment |

**One definition, four renderings.** A command is declared once with its
arguments; each driver renders it as that provider's own idiom, a slash command
on Slack, a bot command on Telegram, a free-form intent on WhatsApp. The router
never branches on provider to decide what an action does, only on how to ask
for what is missing.

Every inbound action writes an audit event with the channel named, which is
what makes "she checked in from Slack" answerable a quarter later.

**Given** a member without edit access on a goal,
**when** they attempt a check-in from any of the four providers,
**then** the refusal is the same sentence the browser shows, and the attempt is
audited with the channel on it.

## 8. Conversational flows

Slack and Teams have modals. WhatsApp and Telegram do not, so the check-in and
the blocker are collected across turns.

### 8.1 The state machine

A conversation is a row: member, provider, thread, the command it is running,
the fields collected so far, and when it expires.

| Aspect | Decision |
|---|---|
| Where the state lives | A `channel_conversations` row, not memory. The relay is stateless and a process restart must not lose somebody's half-finished check-in |
| How long it lives | Thirty minutes, in the §11 registry so a workspace can change it |
| Abandoning | Any message that is not an answer, or the expiry, ends it. Nothing is written |
| Resuming | The next message on the same thread continues it |
| What is written | Nothing until every required field is collected. Then one registry action, one transaction |

**Nothing partial is ever stored as a check-in.** A conversation that collects
status and confidence and then stops leaves no draft, because a draft check-in
somebody did not know they had created is worse than starting again.

**Given** a member part way through a WhatsApp check-in,
**when** they stop replying and the conversation expires,
**then** no check-in exists, the goal is still due, and the next nudge starts
the conversation again from the beginning.

### 8.2 The order of questions

The same order as the browser's composer, which is METHOD.md §3.2's own order:
status, then confidence, then one line of narrative, then each key result's
value. A member who answers the first two and nothing else has told the product
what it most needs, so the narrative and the values are asked last.

## 9. Open questions for the human

| # | Question | My position |
|---|---|---|
| C1 | Does the channel work land before a relay host exists? | Yes, and the design says so out loud: everything is testable without one, nothing delivers with one absent, and R10 already records the gap |
| C2 | Is a member allowed more than one verified identity per provider? | No. Two identities is two people or one person confusing the audit trail |
| C3 | Where do WhatsApp templates live? | A per-nudge-kind registry in `packages/method`, because a template is a coaching message and §11 already owns those |
| C4 | Does a space channel post need its own subscription model? | Not in v1. A space channel is configured on the connection and posts what the space's own feed would show |
