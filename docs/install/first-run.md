# The first run

What the wizard does, and what is worth doing next.

## The wizard asks for one thing

An account. Name, email address, and a password of at least twelve characters.
That account owns the instance.

Nothing else on that screen needs configuring, and the screen says so: every
setting has a working default, so you can create the account and start. Mail,
AI, chat channels, single sign-on and directory sync are all optional, all off,
and all changeable later without downtime.

**Registration closes the moment your account exists.** Everybody after you
joins by invitation. On the managed cloud registration stays open, because a
cloud belongs to nobody.

## What you already have

| Already there | Detail |
|---|---|
| A workspace | Named after you until you rename it |
| A space | Somewhere for the first goals to live |
| Two agent members | The OKR Coach and the OKR Champion, seeded with the workspace. They are members, not features: they appear in lists, they can be mentioned, and they are accountable |
| Every method rule | The twenty-six quality checks, the gates, the corridors and both session formats run with no AI provider at all |

The agents are on their safest setting: they propose, and a person approves.
Nothing they do commits without somebody saying yes.

## Five things worth doing next

**1. Set the timezone and the language.** Admin, then General. Every rhythm
date is read in the workspace timezone, so an instance on the wrong one sends
Monday's nudges on Sunday night.

**2. Configure mail, or know that you have not.** With no mail server the
console driver writes each message to the log, including invitation links and
password resets. That is a working default for a first day and a bad one for a
month: a reset link in a log is a credential. The General screen says so in a
banner while it is the case. See [Settings](../admin/settings.md).

**3. Invite somebody.** Admin, then Invitations. A workspace with one person
in it cannot run a weekly session, and the practice is the product.

**4. Decide about AI.** It is off, and everything works with it off. Turning
it on adds drafting, rewriting and semantic review, never a decision. Bring
your own key from any supported provider, or point it at a local model, which
is what an air-gapped instance does.

**5. Take a backup, and prove it restores.** `./openokr backup` makes one and
`./openokr verify-backup` proves it would restore without touching the live
database. A backup nobody has ever restored is a belief rather than a backup.

## Then start the practice

The product knows which phase of the cycle it is in and what is missing. Open
the Cycle screen and it will tell you what it is waiting for. Drafting is
refused until the input pack is complete, which is deliberate: a planning
session with no inputs produces objectives written from opinion.

## Next

- [Administrator guide](../admin/README.md)
- [People and access](../admin/people.md)
- [Operations](../admin/operations.md)
