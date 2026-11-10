# Single sign-on: proving a domain with DNS

Status: proposed 2026-11-10, waiting for "design approved". Follows `docs/design/sso-account-trust.md`.

Since 0.7.0 a single sign-on connection links and enforces only for members of its own workspace. What it cannot do yet is refuse a password sign-up on its domain, because nothing proves the workspace owns that domain. This document adds that proof: a DNS TXT record (a text entry in the domain's DNS settings) that only the domain's owner can publish.

## What changes

| Today (0.7.0) | After |
|---|---|
| A workspace types any domain into a connection, including `gmail.com` | A domain must be verified before it can be enforced. Free-mail domains can never be verified |
| Enforcement refuses local sign-in for members only | Members as today. A verified domain also refuses a new password sign-up on it and sends the person to the provider |
| Two workspaces can claim the same domain | One verified owner per domain per instance. A second workspace is refused, with the reason |

## The record

| Field | Value |
|---|---|
| Name | `_openokr-verify.<domain>` |
| Type | TXT |
| Value | `openokr-verify=<token>`, where the token is 32 random bytes, base64url, shown once per domain on the SSO screen |

The admin adds the record, then presses **Verify**. The server looks up the TXT record and compares in constant time. Verified domains are checked again every 24 hours; three failed checks in a row (about three days, so a DNS change in progress does not flap) move the domain back to unverified, and enforcement on it stops until it verifies again.

## Rules

| # | Rule |
|---|---|
| 1 | A domain on the free-mail list in `packages/formats/src/free-mail.ts` cannot be verified |
| 2 | A domain verified by one workspace cannot be verified by another. Subdomains are separate domains (exact match, the rule enforcement already uses) |
| 3 | `enforce` can be turned on only when every domain on the connection is verified. Saving an unverified domain is allowed, it simply does not enforce |
| 4 | A new password sign-up on a verified, enforced domain is refused with the existing enforcement message, which names the provider |
| 5 | The lookup goes through a DNS port in `packages/adapters`, not `node:dns` in core, so it can be faked in tests and stays visible to the air-gap checklist |
| 6 | **Air-gapped or no public DNS:** an instance administrator may mark a domain verified by hand. The action is audited with who did it and why |
| 7 | Verifying, failing a re-check, losing verification and an administrator override each write an audit row through the Operation pipeline |

## Data

New table `sso_domains`, migration with row-level security in the same file:

| Column | Type | Note |
|---|---|---|
| `id` | uuid | |
| `workspace_id` | uuid | Tenant floor |
| `domain` | text | Lowercase |
| `token_hash` | text | SHA-256 of the token. The token itself is shown once and not stored |
| `verified_at` | timestamptz | Null until verified |
| `verified_by` | text | `dns` or the administrator's user id |
| `last_checked_at`, `failed_checks` | timestamptz, int | Re-check state |
| `deleted_at` | timestamptz | Soft delete |

A partial unique index on `domain` where `verified_at is not null and deleted_at is null` holds rule 2 in the database. Sign-in reads verified domains before a workspace is known, through a narrow lookup context like `app.sso_lookup`, which allows `select` on this table only. `sso_connections.email_domains` stays for display and is read together with this table. Importer mapping: no legacy source.

## Screens

On the SSO connection screen (S-30 admin, single sign-on), each domain gets a status chip (Not verified, Verified, Check failing) and a **Verify** action that shows the record to add and copies it. No new screen.

## Acceptance criteria

- Given a workspace adds `example.com` and publishes the TXT record, When the admin presses Verify, Then the domain shows Verified and enforce can be turned on.
- Given `gmail.com`, When an admin tries to verify it, Then it is refused with the free-mail reason.
- Given workspace A verified `example.com`, When workspace B tries to verify it, Then it is refused and names neither workspace.
- Given `example.com` is verified and enforced by A, When a new person signs up with a password as `new@example.com`, Then the sign-up is refused with the enforcement message.
- Given the TXT record is removed, When three daily checks fail, Then the domain becomes unverified and enforcement on it stops.
- Given an air-gapped instance, When an instance administrator marks a domain verified, Then it is verified and the audit row names the administrator.

## Open questions for the owner

1. Should **trusted email domains** (join a workspace by email domain, `trustedEmailDomains`) also require verification? It has the same weakness in a milder form: a workspace can offer itself to everybody on `gmail.com`. Recommended: yes, same table, in a second change.
2. Existing connections on upgrade: keep enforcing for members until the domain is verified (recommended, no lockout surprise), or stop enforcing until verified?
3. Re-check every 24 hours and unverify after three failures: acceptable?
