---
"@openokr/web": minor
---

Anybody who can edit a space can now draft an objective or a key result at
any time. The cycle screen no longer refuses drafting while the input pack,
the diagnosis or the direction is incomplete; it lists what those phases
still miss beside the form instead.

A workspace that runs a formal planning process can make the phases binding
with `practice.update` (`"phases.enforcement": "binding"`), or choose to
create new objectives only in the planning window. Either refusal now comes
from one place and reaches the cycle screen, the REST API, the `okr` command
line and the AI agents alike, with the reason and the setting that caused it.
Imports are never refused, because they record work that already happened.

A workspace's first cycle no longer has to be declared: with no earlier cycle
of its kind, the prior-cycle condition of phase 2 is met on its own.

Two §11 thresholds changed. "Team publication window", two weeks after a
cycle starts, is new. "Strategic issue bounds" (3 to 10) became "Strategic
issue minimum" (3): the upper bound was never checked. A workspace that had
raised the floor reads 3 until `pnpm db:change` runs, which carries the
raised floor onto the new minimum.

The `guided` field on `goals.create` and `goals.addKeyResult` is accepted
and ignored for this release, and removed in the next.
