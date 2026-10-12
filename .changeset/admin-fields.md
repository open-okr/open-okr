---
"@openokr/web": patch
"@openokr/ui": patch
"@openokr/core": patch
---

Every admin, account and operator field is labelled and sized for what it holds.

The operator's reasons and the site message grow with the text and count near
their limit. Numbers (a token's expiry, a link's uses and expiry, a budget,
a model's context window and costs, a tier's temperature and token limit,
the ladder rungs, the rhythm thresholds, a plan's seats) are number fields
in the reader's locale, with their unit beside them where they have one.
Keys and passphrases are masked with a way to show what was typed. The nudge
ladder's rungs are named ("Then the coordinator", in days) where their keys
were shown, and each term label says which term and number it is.

A link's expiry is now at most 365 days. API clients sending
`invitations.createPersonalLink` or `invitations.createWorkspaceLink` with a
longer expiry get a refusal.
