---
"@openokr/web": patch
---

Fixes from a review of the 0.2.0 practice work. What changes for a workspace:

- **The rhythm diagnostic counts the week a late check-in was late for.** A
  team that checks in three days after every Monday no longer reads as on
  time for the following week, so §8.6 can name a rhythm problem it used to
  hide. A check-in early for its own due date still counts.
- **Easing a target is judged by direction.** Lowering an increase target or
  raising a reduce target asks for the reason, wherever the baseline sits; a
  maintain key result eases when its band widens. A target changed in the
  same edit as its baseline is judged against the baseline it had.
- **Four company objectives no longer warn.** OBJ-5 holds the company to its
  own cap of five, and counts each team's objectives within the team.
- **A company space's quarterly review can close its scoring stage.** The
  screen lists every objective the stage asks about.
- **Nothing the weekly ceiling holds back is lost.** Held messages join the
  inbox with the morning summary, or at once for a member who turned the
  summary off, and one run can no longer send a member past the ceiling.
- **A recovery's own key result shows recovery.** It reads from the KPI's
  reading at launch to its healthy boundary, so it starts at 0%.
- **Carrying forward keeps a maintain key result's band.**
- **A leave delegate can acknowledge** a check-in owed by the reviewer they
  stand in for, and past leave no longer blocks adding more.
- **Holidays and a slower check-in frequency move a goal's open blockers**
  with its next check-in.
- **A confidence fall in a session's first round is seen**, measured from what
  the key result held before the session.
- **Smaller fixes:** reset to profile restores the profile's value; moving an
  objective into a running cycle is judged as adding it there; withdrawing an
  agreed annual frame needs a reason; a required reviewer defaults to the
  writer's manager where they have one; a stopped draft cannot be published; a KPI owned by an imported person is
  accepted; the feed says the right counts; the timeline matches METHOD §2.4.
- **On screen:** typing a "why now" reason no longer jumps the caret to the
  title; the diagram shows conflicts and errors; `+ New` opens the form on the
  OKRs screen too; a first baseline of 0 is recorded from the drawer.
- **The demo:** no check-in dated after today, the year builds in every
  calendar year, personas are offered only once they have joined, and
  `demo:prepare` refuses any workspace that does not hold the demo's own
  objectives.
