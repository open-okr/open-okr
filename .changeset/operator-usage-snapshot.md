---
"openokr": minor
---

Per-tenant usage figures for the cloud operator, taken without loosening a
single policy.

An operator can see how many members, goals and check-ins a workspace holds,
how much storage it uses, and when it was last active, without being able to
read anything inside it. The numbers come from a snapshot refreshed by a
scheduled measurement that opens each workspace properly and counts what a
member of that workspace would count, so no content table gains a policy and
no database role gains a privilege to make it work.

The snapshot carries the instant it was taken, shown beside the numbers, so a
figure from this morning cannot be mistaken for a live one.

**A workspace can now read its own usage row**, which is the same set of
numbers a plan and seats screen will want.

Instance administration can also list workspaces now. Enumerating them needed
a database role that could see past the tenant floor entirely; a select-only
policy is a much smaller privilege and does the same job.
