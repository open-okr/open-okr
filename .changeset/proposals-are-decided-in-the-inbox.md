---
"openokr": patch
---

An agent's proposal is now decided on the Review screen, by the person it is
for.

The Champion drafts an overdue check-in for a goal's champion, and proposes a
recovery objective to a KPI's owner when the metric stays out of its corridor.
Review listed the drafted check-in as something the champion owed, but its
button opened the administrators' agent screen. Anybody who was not an
administrator was turned away there, so they could not publish their own
drafted check-in. The recovery proposal was worse off: it was listed for
nobody at all.

Each proposal now sits on its own row in Review. The row shows what applying
it would change and whether AI wrote the words, with Apply and Dismiss beside
it. A proposal the Champion sent you in a reminder is yours to decide, and
nobody else sees it as something they owe. Any other agent proposal goes to
the people who can edit what it changes. Applying runs the change in your
name, with your own access, exactly as if you had made it yourself. Only a
person can apply or dismiss a proposal: an agent never approves its own.

The administrators' queue on the agents screen is unchanged. Both decisions
are also available to the API and the command line as `proposals.apply` and
`proposals.dismiss`.
