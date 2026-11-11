# Single sign-on: proving a domain with DNS

Status: design approved 2026-11-10. Follows `docs/design/sso-account-trust.md`.

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
| 6 | **Air-gapped or no public DNS:** an instance administrator may mark a domain verified by hand. The action is audited with who did it, which authority they used and why. The administrator of a self-hosted instance may (the same rule the instance name and the AI endpoint guard use); on a managed cloud only the operator may |
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

On the SSO connection screen (S-30 admin, single sign-on), each domain gets a status chip (Not verified, Verified, Check failing) and a **Verify** action that shows the record to add and copies it. No new screen. A domain in Check failing has a **Check now** button that looks the record up again: a match clears the failed count (audited as a recovery), a miss changes nothing, so only the daily job counts toward unverifying.

## Acceptance criteria

- Given a workspace adds `example.com` and publishes the TXT record, When the admin presses Verify, Then the domain shows Verified and enforce can be turned on.
- Given `gmail.com`, When an admin tries to verify it, Then it is refused with the free-mail reason.
- Given workspace A verified `example.com`, When workspace B tries to verify it, Then it is refused and names neither workspace.
- Given `example.com` is verified and enforced by A, When a new person signs up with a password as `new@example.com`, Then the sign-up is refused with the enforcement message.
- Given the TXT record is removed, When three daily checks fail, Then the domain becomes unverified and enforcement on it stops.
- Given an air-gapped instance, When an instance administrator marks a domain verified, Then it is verified and the audit row names the administrator.

## Decisions (2026-11-10)

| # | Question | Decision |
|---|---|---|
| 1 | Should trusted email domains also require verification? | No. This change covers single sign-on only |
| 2 | Existing connections on upgrade | Keep enforcing for members as in 0.7.0. Only the sign-up refusal (rule 4) waits for verification |
| 3 | Re-check every 24 hours, unverify after three failures | Accepted |

## Delivery

Two changes, one commit each:

| Change | Contents |
|---|---|
| A. Data and rules | Migration with RLS, DNS port and driver, verify and override actions through the registry, rule 2 and 3 checks, sign-up refusal, daily re-check job, tests |
| B. Screen | Status chip, Verify dialog with the record to copy, administrator override, catalogue keys in every locale, end-to-end spec |

## Implementation notes (change A)

Where the code is exact about something the sections above leave open.

| Topic | What the code does |
|---|---|
| Rule 3 on an existing enforcing connection | Decision 2 keeps it enforcing. An edit that leaves its domain list alone is not refused. A domain the edit adds must be verified |
| Re-check scope | Only domains verified by `dns` are looked up. A domain an administrator marked by hand is not, because an instance with no public DNS would fail every check and lose the thing the override grants |
| A resolver that does not answer | Not a failed check. It says nothing about the domain, so it neither adds to the count nor resets it |
| "Enforcement on it stops" | The refusal of a new password sign-up (rule 4) stops, because it needs a verified domain. Refusing a member's local sign-in does not depend on verification (decision 2), so it carries on |
| Rule 6 | Two ways in, both with a required reason and an audit row naming the person and the authority (`instance_admin` or `operator`). On a self-hosted instance the administrator of the workspace uses `sso.markDomainVerified`, which is "instance administrator" as the instance name card and the AI endpoint guard already read it (cloud flag off, workspace `full`). On a managed cloud that action refuses, and only a live operator may, through `markDomainVerifiedAsOperator` (not a registry action). A free-mail domain is refused either way |
| Rule 2 at start | Not checked. Another workspace's row is behind row-level security, so the refusal comes at verify, from the unique index |
| Daily job | `sso.recheckDomains`, 05:10 UTC, per workspace, as the system. Each failed check, the third that unverifies and a recovery write an audit row. A clean pass writes only `last_checked_at` |
