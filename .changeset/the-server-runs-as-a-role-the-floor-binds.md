---
"@openokr/web": minor
---

The server no longer connects to its database as a superuser, the scheduler
starts under the role it does connect as, and rotating the root key no longer
breaks every stored AI key and chat credential.

**The database role.** A Docker Compose install connected as the Postgres
image's own role, which is a superuser. Postgres never applies row-level
security to a superuser, so the rule that keeps one workspace out of another's
rows was switched off on the default install. The product still checked access
on every request, but the second line of defence was gone. The server now
connects as `openokr_app`, which cannot bypass row-level security, and the
image's own role is kept for migrations and backups. An existing install is
moved over on its next `./openokr up` or `./openokr upgrade`, and its previous
`secrets/app.env` is kept beside the new one.

**The scheduler.** Under a restricted role the job queue could not create its
own schema, so the scheduler logged one line and stopped: no Coach, no
Champion, no reminders, no digests, no staleness sweep, while the instance
reported healthy. A migration now creates that schema for the application
role, and the scheduler lists workspaces through a read-only scan the database
allows for exactly that purpose.

**Saying so.** `/api/health` now reports whether the scheduler is running and
whether the tenant floor is enforced, the status page counts a scheduler that
failed to start as unavailable at once rather than two hours later, and
`/admin/general` warns about either. The server also warns at boot when its
database role bypasses row-level security, which a Kubernetes install pointed
at a superuser can still do.

**Root key rotation.** `./openokr rotate-key` re-wrapped the instance's own
secrets and none of the ones workspaces hold. AI provider keys, chat channel
credentials and single sign-on client secrets are sealed under the same key,
and the command removes the previous key as soon as rotation finishes, so all
of them became unreadable. Rotation now re-wraps every one, in every
workspace, including deleted ones a restore could bring back. The command also
waits for the instance to be serving again before it returns, as `upgrade`
now does.

**Restore.** `./openokr restore` ran a library file with no entry point and
ignored the result, so migrations never re-ran after a restore. It now runs
the container's own migrator, which also re-applies the application role's
privileges that a restore does not carry, and fails loudly if it cannot.
