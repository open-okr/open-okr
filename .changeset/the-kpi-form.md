---
"@openokr/web": minor
---

The KPI form now sets how a KPI is judged (METHOD.md §6.2, §6.4): its target
type, and green and red values or a green band for a range. Without them it
says what the ratio to target does not suit: uptime, ratings, NPS, or anything
that can go negative. The KPI page gains a "How it is judged" block to change
the type, the thresholds, the owner and the tier afterwards.

A KPI can now name one person who owns it, separately from where it lives.
That person hears when it leaves its corridor; a KPI with nobody named keeps
the old recipients. The form names whoever adds the KPI, a KPI on a member's
own list is owned by that member, and `kpis.create` and `kpis.update` take
`ownerMemberId`. The tier is optional: `kpis.create` leaves it empty unless one
is given, and the reads return null for a KPI without one.
