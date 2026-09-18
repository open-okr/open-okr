# Using OpenOKR

What each screen is for. The practice behind them is in
[the handbook](../handbook/README.md); this is the product.

## The screens you will live in

| Screen | What it answers |
|---|---|
| **Overview** | The Work Map: one tree of goals, key results, initiatives and KPIs. Where everything is, and what is outdated |
| **Inbox** | What arrived for you |
| **Review** | What you owe, computed on the server, overdue first |
| **Cycle** | Which phase the cycle is in, what is missing, and who owes it |
| **Goals** | The objectives and their key results |
| **KPIs** | The driver trees, the corridors, and anything recovering |
| **Initiatives** | The work that moves a key result |
| **Board** | That work as a board, linked to the key result it serves |
| **Check in** | The one screen for reporting progress |
| **Sessions** | The weekly and quarterly sessions, run by the product |
| **Scorecard** | How the cycle is going, by the numbers |
| **Spaces** | Teams, and what each one owns |

## Checking in

The one thing to do every week. The check-in walker lists **only what is
actually due**, so an empty list means you are done rather than that something
is hidden.

A check-in takes a value, a confidence and a sentence about what changed. The
sentence matters more than it looks: it is what the weekly session reads, and
"on track" with no sentence is the thing staleness exists to catch.

Every check-in takes an immutable snapshot. Editing what you said later does
not rewrite what the cycle looked like at the time.

## The review inbox

Everything you owe, in one place, computed rather than remembered. Each item
shows the rule that put it there, which channel it reached you on, and where it
sits on the escalation ladder.

**Snoozing quietens the message and never hides the obligation.** The inbox
still lists it. That is deliberate: a snooze that hid the item would make the
inbox a lie.

## The weekly session

Open it from Sessions. The product runs the four steps, keeps the clock, and
assembles the digest at the end. Confidence votes reveal together, so nobody
anchors on the champion.

Everything works in the browser. If your team lives in Slack, Teams, WhatsApp
or Telegram, the same session reaches you there and a check-in typed into chat
runs through the same permission checks as a click.

## Goals, and what the colours mean

| State | Means |
|---|---|
| On track | Reported healthy, and checked in recently |
| At risk | Reported at risk, or confidence below the line |
| **Outdated** | Nobody has checked in within the grace period. **This overrides whatever health was last reported** |
| Closed | Deliberately ended, with a retrospective |

Outdated is the one worth understanding: it is not an opinion, and an owner
cannot claim their way out of it.

## KPIs

A KPI is a number you watch continuously, not a goal you set for a quarter.
Each sits in a health corridor. When one drops out of range the product drafts
a **recovery objective**: one key result per leading child driver, capped at
four. The KPI then reads "recovering" and its effective health rises as that
objective moves.

## The copilot

Ask it about your own workspace. It answers from what you are allowed to see,
cites what it read, and proposes rather than writes. With no AI provider
configured the panel says so instead of failing.

## Your own settings

**Account, then Where to reach you.** Your primary channel, quiet hours, how
notifications are batched, whether a mention interrupts, and a daily summary if
you want one. These are yours; no administrator overrides them.

Quiet hours are respected by every proactive message.

## Next

- [The handbook](../handbook/README.md) for the practice
- [The API](../api/README.md) if you want to script something
