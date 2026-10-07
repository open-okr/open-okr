---
"@openokr/web": minor
---

An admin can choose how the workspace runs its OKRs from the browser.

Admin, Practice lists the five profiles: Recommended, Google-style, Radical
Focus, Lightweight and Governed. Choosing one shows what it would change
before anything is written, and what the workspace changed itself, which is
kept. Below it, every practice setting sits on its group's card with its own
save: who may write and when, phase enforcement, the model, each quality
check and publish gate, levels in use, scoring, the rhythm, the review and
KPIs. A setting the workspace changed is marked, with the profile's own value
beside it, and "Reset to profile" puts a card back.

Choosing a profile now also sets the numbers it carries. Lightweight makes
check-ins fortnightly and Radical Focus caps objectives at one per team, and
switching away puts them back, unless the workspace had changed them itself.
`practice.applyProfile` returns the thresholds it changed and the ones it
kept, and `practice.read` returns each option's words as METHOD.md §12.1
writes them.

Strict mode is now the one switch that makes every quality check refuse
rather than coach. "Coach strictness" has left the rhythm card, and a data
change turns strict mode on for every workspace that had set it to strict. A
space's own strictness is unchanged.
