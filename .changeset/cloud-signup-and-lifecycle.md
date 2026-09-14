---
"openokr": minor
---

Cloud signup, the workspace lifecycle, and a verification rule that helps
self-hosted instances too.

**A sign-in now waits for a verified address as soon as the instance can
actually send mail.** `requireEmailVerification` has been off since the first
release with a good reason: a fresh instance has no mail server, and blocking
the first login on a link nobody can receive makes the product unusable out of
the box. That reason stops applying the moment `mail.transport` is something
other than `console`, and it stops applying whether the instance is a managed
cloud or somebody's own server. An unrecognised transport does not count as
delivering, so a typo cannot lock everybody out.

The answer is resolved once at boot, so changing the mail transport needs a
restart before sign-in behaviour follows.

**A cloud instance keeps registration open.** The existing rule closes
registration once somebody has claimed the instance, which is right for a
server that belongs to whoever set it up and wrong for a cloud, where it would
mean exactly one customer ever signed up. An operator setting
`registration.policy` to invitation-only still closes it, because an explicit
choice beats a computed default.

**A cloud workspace can be suspended, closed and reopened.** A suspended
workspace is read-only and a closed one is frozen, through the permission
overlay that already refuses those writes rather than through a second check.
Member and settings management keeps working in both, which is what lets a
suspension be lifted.

**Nothing is ever erased without somebody choosing a number.**
`cloud.closureRetentionDays` is zero out of the box, and the sweep reads that
setting and returns before it looks at a single row. `pnpm cloud:sweep` reports
what retention is set to and which closed workspaces a future erasure would
name. It deletes nothing.

**A row-level security fix.** The tenant policy on `tenants` now treats an
empty setting as absent. On a pooled connection that had already served a
request, the previous expression raised an error rather than returning no
rows: fail-closed either way, and nothing ever leaked, but it stopped a
second permissive policy from applying.
