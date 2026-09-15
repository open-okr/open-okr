---
"openokr": minor
---

A cloud operator can suspend a workspace, and the workspace can see who did
it.

Suspension goes through the same lifecycle path a member would use, so the
permission overlay that already refuses writes in a read-only workspace is
what refuses them here too. A reason is required and the workspace's own
members are shown it.

**The audit row names the operator.** Until now an operator's action could
only be recorded as an empty actor, because an operator is a member of no
workspace and the actor column points at members. A support action that reads
as the customer's own work is a falsified record, and a suspension a customer
cannot see attributed is one they have to take on trust.

Somebody without a live operator grant gets the same answer as somebody asking
about a workspace that does not exist.
