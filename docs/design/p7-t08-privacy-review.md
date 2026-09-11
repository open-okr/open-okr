# P7-T08: where personal data actually goes

The review half of P7-T08: what reaches logs, prompts and telemetry today,
and the four findings. Written 11 September 2026.

Nothing is changed by this document. Three of the four findings touch stored
user data or change behaviour on a live instance, which CLAUDE.md puts in a
human's hands.

## Why the task was cut

P7-T08 carries three deliverables, and the middle one deletes rows on a
clock:

1. Personal data export and erasure as anonymisation, tested end to end.
2. Retention settings for message logs, nudge records and agent run logs.
3. A review that no personal data reaches logs, prompts or telemetry.

Twenty-four schema files hold a member reference. A per-member export has to
enumerate them, and erasure has to decide, table by table, what is
anonymised and what is deleted. A retention sweep then deletes rows on a
schedule. None of that fits one session, and the defaults are not mine to
choose: **a retention default nobody asked for destroys real data on a
timer.**

So the card is cut into three, and this document is the third part, which
destroys nothing and needed no decision.

| Part | What it is |
|---|---|
| P7-T08a | The review. This document. |
| P7-T08b | Personal export and erasure across every table that holds a member. |
| P7-T08c | The three retention settings and the sweep that honours them. |

## Telemetry: clean, and provable

The metrics added at P7-T06 carry no personal data by construction. No
workspace id, no member id, no address, no title, no message body, and no
provider error string.

That is not a promise in prose. Labels are typed as
`Readonly<Record<string, string>>`, the rule is written at the declaration
in both `packages/core/src/telemetry/recorder.ts` and
`packages/adapters/src/ports/telemetry.ts`, and
`docs/runbooks/observability.md` states it with a test that checks the
runbook against the code.

Spans carry an action name and an access level. A failed span records the
error's **class name** and never its message, for exactly this reason: an
error from this product can name a goal or echo a provider's body, and a
span leaves the host.

Nothing leaves at all unless `observability.otlp.endpoint` is set, and it is
empty.

**Nothing to do here.** This half of the acceptance criterion holds today.

## Finding 1. The console mail driver logs every message, and it is the default

`mail.transport` defaults to `console`, which is what makes a fresh instance
work with no mail server. That driver writes each message to stdout: the
recipient's address, the subject and the body.

So on a default install, every invitation, every digest and every password
reset is written to the process log with the address of the person it was
for. Container logs are usually shipped somewhere.

This is the driver doing its job. An operator running the first-run wizard
needs to see the invitation link to click it, and masking the address would
make the driver useless for the purpose it exists for.

The question is not whether the driver should log. It is whether a *long
running* instance should still be on it, and whether anything says so. Today
nothing does: an instance can serve for months on the console transport with
no warning anywhere.

## Finding 2. An unrecognised transport silently becomes `console`

`packages/core/src/secrets/mail-settings.ts` resolves the transport as:

```ts
transport: transport.value === "smtp" ? "smtp" : "console",
```

with the reason written beside it: *"Anything unrecognised falls back to
console: a typo in a settings row must not take password reset down with
it."*

**This is a deliberate trade, and its privacy cost was not part of it.** A
typo does not take password reset down. It moves password reset into the
process log, along with every address and every live reset link. Down is
visible and somebody fixes it within the hour; this is invisible and can run
for a quarter.

The distinction the code does not draw is between *absent* and *wrong*.
Absent means "not configured yet", and falling back to console is right.
`smpt` means somebody meant SMTP, and the honest answer is to refuse the
value and say which setting is wrong.

Narrowest fix, for a human to approve: keep the fallback when the setting is
unset or empty, and treat a non-empty unrecognised value as a configuration
error naming the setting. It would surface a misconfiguration that currently
loses mail in silence.

## Finding 3. The password-reset fallback writes an address and a live link

`packages/core/src/auth/auth.ts` writes, when no mailer is configured:

```
--- password reset (no mailer configured) ---
to:  <address>
link: <live reset link>
```

The same shape of finding as 1 and for the same reason: the path has to work
because mail is optional by design. Worth listing separately because a reset
link is not only personal data, it is **a credential**. Anyone who can read
the log can take the account.

## Finding 4. Erasure stops at the member row

`people.erase` anonymises `workspace_members`: name, title, bio, avatar,
timezone, quiet hours and the user link. It exports the prior profile and
suspends the row.

It does not touch:

| Where | What is left |
|---|---|
| `channel_connections`, `channel_identities` | The external account id and handle that identify them on Slack, Teams, Telegram or WhatsApp |
| `channel_messages` | Message payloads addressed to them, body text included |
| `channel_conversations` | The conversation keyed to their account |
| Copilot threads and prompts | Whatever they typed, and whatever was retrieved on their behalf |
| `api_tokens`, `oauth` grants | Tokens issued to them |

The acceptance criterion says no personal data of theirs remains in message
logs or prompts. Today it does.

**The export is also thinner than the criterion.** It produces the prior
profile, not the member's own content, so "an export is produced" is met in
form rather than in substance.

## What P7-T08b and P7-T08c need decided first

These are the questions, and none of them is mine.

1. **Erasure: anonymise or delete, per table.** A check-in a member wrote is
   their content and the workspace's record at once. Anonymising keeps the
   history readable and the audit trail intact; deleting satisfies a stricter
   reading of erasure and leaves holes in a quarter's record.
2. **Channel messages.** Delete the payload, or keep the row and blank the
   body? The row is the delivery record the audit refers to.
3. **The three retention defaults.** How many days for message logs, nudge
   records and agent run logs, and is the default "keep forever" with
   retention opt-in, or a real number out of the box? A number out of the box
   deletes data on instances that never chose it.
4. **Findings 1, 2 and 3.** Whether the console driver should warn after some
   age, whether a typo should refuse, and whether the reset link should be
   logged at all.
