---
"openokr": patch
---

A key result value that runs to nine digits can be read and typed.

Values are stored in an unbounded `numeric` column and nothing in the product
caps them, so a measure in rupiah, impressions or units has always been able to
reach a hundred million. Nothing rendered one legibly. Every key result value
was printed without grouping, which puts `100000000` one glance away from
`10000000`, and the inputs that accept them were narrow enough to hold five of
the nine digits somebody was typing.

The goal detail, the check-in composer, the drafting board, the Work Map panel
and the review's scoring evidence now group the integer digits of every value,
baseline and target, and the six inputs are wide enough to show a whole one.

Grouping is done by counting digits rather than by locale formatting, because
locale formatting rounds to three fraction places by default and would have
displayed a stored value the product never held.
