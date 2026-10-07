---
"@openokr/web": minor
---

The alignment checks now coach at the level METHOD.md §4.3 gives them. A
level skip (AL-3) and a possible silo (AL-6) are off by default, so neither
is listed nor sent as a nudge unless a workspace turns the check on in its
practice settings; a skip is measured over the levels the cycle uses, so a
cycle without departments never counts one. AL-1 warns rather than fails,
passes a goal that states its contribution, and warns on a contribution under
the new "Contribution minimum" (3 words). The health panel lists every goal the
share did not count, and the drawer's alignment tab asks an objective with no
parent why it stands alone. Publish gate 3 accepts that reason.
`alignment.read` adds `uncounted`, and an identical nudge raised twice in one
run is now sent once.
