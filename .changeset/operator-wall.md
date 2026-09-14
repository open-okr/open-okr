---
"openokr": minor
---

The cloud operator, and the wall between them and every customer's content.

A new instance-level grant makes somebody an operator. An operator is not a
member of any workspace, and reaching across workspaces goes through a narrow
database key that names exactly three things: the tenant rows, the workspace
rows, and the operator table itself. Every one of them is read-only.

**No content table names that key, and none ever should.** An operator's
connection returns zero rows from goals, check-ins, comments, documents and
every other table carrying a workspace, whatever the application code above it
does. That is proved against every such table rather than against a sample.

Revoking a grant takes effect on the operator's next query rather than at
their next sign-in, because the check is in the policy rather than in a
session.

**A row-level security fix.** One tenant policy, on workspace archive imports,
compared against an empty setting rather than treating it as absent. On a
pooled connection that had already served a request it raised an error instead
of returning no rows. Fail-closed either way and nothing ever leaked, but the
error stopped a second permissive policy from applying. Every other policy in
the schema already had the guard.
