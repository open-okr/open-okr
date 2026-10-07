---
"@openokr/web": minor
---

A dependency nobody can confirm can now be escalated to the cycle's sponsor
(METHOD.md §5.4), from the dependency register or through
`goals.escalateDependency`. The sponsor's review inbox lists it until the
providing team confirms it or somebody is named to carry the risk. An
escalated dependency settles publish gate 4, as a confirmation or a risk owner
does, and no longer draws the unowned-dependency nudge. Nothing new is sent:
the inbox carries it. `alignment.read` adds who each entry was escalated to,
when, and the cycle's sponsor.
