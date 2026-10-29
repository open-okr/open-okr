---
"@openokr/core": patch
---

Eighteen actions that take something away are now in the destructive class:
`people.erase`, `invitations.revokeLink`, `channels.disconnect`,
`channels.unlinkIdentity`, `channels.removeTemplateMapping`, the five
`ai.remove*` actions, `attachments.detach`, `tasks.removeChecklistItem`,
`initiatives.unlinkKeyResult`, `goals.unlinkKpi`, `goals.deleteCheckIn`,
`goals.removeDependency`, `goals.removeKeyResultDependency` and
`sessions.removeRetroNote`. An API or agent token now needs the `destructive`
scope to call them, and AI clients see `destructiveHint` and ask first. A
token with only read and write that relied on one of them must be reissued
with the destructive scope. The screens are unchanged.
