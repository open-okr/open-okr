# Using OpenOKR

What each screen is for. The method behind them is in
[the handbook](../handbook/README.md); this is the product.

## The screens you will live in

| Screen | What it answers |
|---|---|
| **Home** | My week: the goals you own and the check-in each one needs. For the people who run the cycle it also shows the rhythm by team and the Work Map |
| **Updates**, tab **To do** | What you owe, computed on the server, overdue first |
| **Updates**, tab **Activity** | What arrived for you |
| **Goals**, tab **OKRs** | The objectives and their key results |
| **Goals**, tab **KPIs** | The driver trees, the corridors, and anything recovering |
| **Goals**, tab **Map** | The Work Map: one tree of goals, key results, initiatives and KPIs. Where everything is, and what is outdated |
| **Work**, tab **Initiatives** | The work that moves a key result |
| **Work**, tab **Board** | That work as a board, linked to the key result it serves |
| **Check in** | The one screen for reporting progress, opened from a button on OKRs, on a goal and on Updates |
| **Spaces** | Teams, and what each one owns |
| **Cycle** | Which phase the cycle is in, what is missing, and who owes it. In the sidebar only for administrators and for a space's coordinators and managers |
| **Cycle**, tab **Sessions** | The weekly and quarterly sessions, run by the product |
| **Cycle**, tab **Scorecard** | How the cycle is going, by the numbers |

## Checking in

The one thing to do every week. The check-in walker lists **only what is
due, or due within two days**, so an empty list means you are done rather than
that something is hidden.

A check-in takes a value for each key result, a confidence, a status and a few
sentences about what moved, what is in the way and what happens next. The
sentences matter more than they look: they are what the weekly session reads,
and "on track" with no sentence is the thing staleness exists to catch.

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
| No check-in yet | Nobody has checked in yet, and the grace period has not passed |
| On track | Reported on track at the last check-in |
| At risk | Reported at risk at the last check-in |
| Off track | Reported off track at the last check-in |
| **Outdated** | Nobody has checked in within the grace period. **This overrides whatever health was last reported**, which is shown beside it, such as "Outdated, last on track" |
| Achieved, missed or abandoned | Closed, deliberately, with a retrospective. Abandoned is a stop with its reason, not a miss |

Outdated is the one worth understanding: it is not an opinion, and an owner
cannot claim their way out of it.

## Writing and changing OKRs

**Anybody allowed to edit objectives can write an objective or a key result
at any time.** The planning phases show what is still missing beside the form;
by default they do not stop you. The
coach warns beside the work rather than refusing it, and only a structural
defect, such as an objective with no key result, holds a set back from
publishing.

An objective is **committed**, which the team agrees will be done and is
expected to score 1.0, or **aspirational**, a stretch expected to land around
0.7. A key result is a **metric** that moves a number, a **maintain** that
holds one inside a band, a **milestone** that is done or not done, or a
**baseline** that measures what nobody has measured yet.

Changing course mid-cycle is allowed and recorded. An objective started after
the plan is marked as an addition, a stopped one closes as abandoned with its
reason, and an eased target keeps its original beside it. The close reads all
of it.

How strictly any of this applies is your workspace's choice. **Admin,
Practice** holds every setting with the method's default, and a profile such
as **Governed** sets a stricter practice in one step.

## KPIs

A KPI is a number you watch continuously, not a goal you set for a quarter.
Each sits in a health corridor, in its own units. When one turns unhealthy its
owner chooses one of three responses: fix it now, add a key result to an
objective that already exists, or launch the **recovery objective** the
product drafts: the KPI itself as the first key result, then one per leading
driver that is below its target, four in all at most. The
KPI keeps reading the band its value is in, with the recovery shown beside it,
so a recovery never makes a red number look green.

## The quarterly review

Ninety minutes in four acts, Open, Review, Retro and Reset, booked about two
weeks before the cycle ends; a workspace may hold the review and the
retrospective as two sessions. The product keeps the clock and the stages.
Every key result is graded with a reason, every objective closes on one of
five decisions, achieved, keep, modify, defer or abandon, and the minutes
are written as the room goes. When the cycle closes, a kept or modified
objective arrives in the next one as a draft, its key results starting from
where they ended.

## The copilot

Ask it about your own workspace. It answers from what you are allowed to see,
cites what it read, and proposes rather than writes. With no AI provider
configured the panel says so instead of failing.

## Your own settings

**The avatar menu, then Where to reach you.** Your primary channel, quiet
hours, how notifications are batched, whether a mention interrupts, and the
daily summary, which is on until you turn it off. These are yours; no administrator overrides them.

Quiet hours are respected by every proactive message.

## Next

- [The handbook](../handbook/README.md) for the practice
- [The API](../api/README.md) if you want to script something
