---
"openokr": patch
---

Single sign-on and directory sync can now read their own configuration.

Both features shipped with a tenant-only row-level security policy on tables
whose reads run before any workspace is known. The application role is
`nosuperuser nobypassrls` and owns nothing, so those reads returned nothing on
every instance with a correctly provisioned database:

- No SSO provider was loaded at boot, so none was ever configured.
- No SSO button appeared on the sign-in page.
- Every SCIM request resolved to no workspace and answered 401, and a
  workspace could not issue a SCIM token in the first place.
- Every directory sync log line was refused, and the refusal was swallowed.

Nothing failed loudly, because a read returning no rows is what a correct
tenant floor looks like from above.

Two policies fix it, and both keep the floor rather than lifting it.
`sso_connections` gains a select-only policy for the provider list, which is a
list rather than a row and is the only key in the product that names no row;
it opens that one table, cannot write, and the client secrets in those rows
stay envelope-encrypted. `directory_sync_tokens` admits one row through the
digest of the bearer token the caller already holds, the same arrangement API
tokens have used since the REST surface shipped, and its write check stays
scoped to the workspace.

Upgrading applies migration 0094. An instance that had configured an identity
provider and seen nothing happen will find it working after the next restart.
