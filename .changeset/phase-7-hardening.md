---
"openokr": minor
---

An instance can now watch itself, forget what it no longer needs, and hand a
member their own data.

**Observability.** A new `/api/metrics` endpoint serves this instance's own
measurements to an instance administrator, in Prometheus format, over its own
origin. Sixteen series cover every action with its duration and outcome, the
Operations underneath them, authorisation decisions, the outbox queue's depth
and age, scheduled jobs, nudges with the reason each was sent or held,
channel delivery per provider, realtime fan-out, agent runs, and AI spend.
Two dashboards ship as files and a Compose profile runs them locally, off
unless you ask for it. Nothing leaves the host unless you set
`observability.otlp.endpoint`, which is empty.

**Privacy.** Erasing a member now removes the account they are known by on
Slack, Teams, Telegram or WhatsApp, the codes that linked them, the tokens
issued to them and their copilot conversations, and blanks the words inside
messages addressed to them. What they wrote stays, under a placeholder
identity, so a quarter's record is still readable and the audit chain still
verifies. The erasure produces an export of their own data first, covering
every table that holds them, and says in the file what it left out and why.

**Retention.** `messageLogRetentionDays` sweeps the channel message log on a
daily schedule. It defaults to zero, which means delete nothing: an instance
upgrading into this loses no row it did not agree to lose. Nudge records and
agent run logs are never swept, because they are the record of what the
product did on your behalf.

**Mail.** A misspelt `mail.transport` is now refused, naming the setting,
instead of silently falling back to writing every message to the process log.
Leaving it unset still gives you the console driver, and the general settings
screen now says when an instance is using it, because that driver logs every
address and every password-reset link rather than delivering them. The reset
fallback no longer prints the link outside development.

**Coaching.** The objective check that asks "could you complete this without
anything actually improving?" fired on nineteen real drafts out of twenty. It
now recognises an end state by the shape of the sentence rather than only by
a list of words, so "Make onboarding something new customers finish by
themselves" passes and "Launch the new mobile app" still does not.
