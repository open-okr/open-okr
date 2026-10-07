---
"@openokr/web": minor
---

**0.2.0: the practice becomes yours to adapt.** OpenOKR still ships one OKR
method, METHOD.md, and now ships it as defaults rather than as locks. Every
rule says how strongly it applies, every workspace starts on the
Recommended profile, and an administrator adapts it in Admin, Practice
(METHOD.md §12).

What an upgraded workspace will notice, each described in its own entry
below:

- Anybody can write an objective or a key result at any time; the planning
  phases guide rather than refuse.
- Only structural defects block publishing: gates 1 and 2 block, gates 3
  to 5 warn, gate 6 is off. The quality checks coach rather than refuse.
- Committed and aspirational objectives, and metric, maintain, milestone
  and baseline key results. Existing objectives are aspirational and
  existing key results metrics, or maintains where their direction said so.
- A reviewer per goal is optional.
- Additions, stops and eased targets mid-cycle are recorded with their
  reasons, and the close reads them.
- "At risk" is the label for caution, health reads the pace of the cycle,
  and a check-in that disagrees with the data is flagged.
- Scores can be adjusted with a reason, and a closed cycle keeps the rules
  it was graded under.
- A space can set its own check-in frequency and holidays, and a member on
  leave has a stand-in.
- The quarterly review is 90 minutes in four acts, about two weeks before
  the end, with five close decisions; a kept objective arrives in the next
  cycle as a draft.
- Nudges say the coach's line for the situation, in METHOD.md's words.

**The way back is the Governed profile**, which binds the phases, blocks on
gates 1 to 5 and requires a reviewer, among the rest of 0.1's strictness.
Choose it in Admin, Practice.

**Upgrading.** `./openokr upgrade` as usual, then run the data changes once
(`pnpm db:change`). The upgrade runbook's "0.1 to 0.2" section,
docs/runbooks/upgrade.md, has the whole list.
