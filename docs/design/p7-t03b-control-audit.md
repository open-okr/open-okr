# P7-T03b: the §8.2 control audit

Written 10 September 2026 against `agung` at `583a6c9` plus the uncommitted
P7-T02a work.

## What this is

TECHNICAL-PLAN.md §8.2 lists seventeen security controls. This walks each one
against the code and marks it **verified**, **partial** or **absent**, with the
file that settles it. P7-T03b's acceptance is that every row carries either a
verified mark or an accepted-risk note Agung signs, so the partial and absent
rows below are the ones needing a decision, not the verified ones.

**What this is not.** It is not a penetration test and it does not claim the
controls are sufficient, only that they exist and do what §8.2 says. Where a
control is verified by a test, the test is named; where it is verified by
reading, the file is named and that difference is stated rather than blurred.

## The table

| # | Control | Verdict | Evidence |
|---|---|---|---|
| 1 | Sessions | **Verified** | `auth.ts:159-162` sets `httpOnly`, `sameSite: lax`, and `secure` whenever the base URL is https. Tokens are hashed at rest by `withHashedSessionTokens` wrapping the adapter (`auth/session-hashing.ts`). The session list with revoke is `/account/security`, restyled at P6-G24 |
| 2 | Multi-factor | **Verified** | The passkey plugin and the two-factor plugin are both registered (`auth.ts:15,21,275`). Backup codes are issued on enrolment and shown once, which `account/security/security-settings.tsx` states as the reason |
| 3 | Brute force | **Partial** | Better Auth's limiter is on in **every** environment including tests, deliberately, with per-endpoint rules for sign-in, sign-up, both second factors and forgot-password (`auth.ts:173-196`). The REST surface limits per token (`api/v1/[[...path]]/route.ts:120`), the device login limits too, and channel inbound has a rate-limit step (`channels/inbound.ts:60`). **The export download route has none**. See finding F-1 |
| 4 | Headers | **Verified** | `apps/web/proxy.ts` builds a fresh nonce per request and a CSP around it (`:165-172`), plus `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` and HSTS (`:191-198`) |
| 5 | Input | **Partial** | Zod on every action through the registry. Rich text is validated and rendered through the sanitising allow-list. Uploads carry a fixed type allow-list and a 25 MiB ceiling, and SVG is excluded with its reason written down (`blobs/validation.ts`). **Images are not re-encoded**, which §8.2 asks for. See finding F-2 |
| 6 | Authorisation | **Verified** | Layers 1 and 2 exist and P7-T03a now fuzzes the tenant floor across all 116 tables. Maximum-wins composition, suspended-member exclusion and the fail-closed subject resolver are all in `access/reads.ts` and covered by `access-model.test.ts`. The lint on raw reads is `protected-read-outside-getter` in `config/src/boundaries.ts:573`, with an `allow-raw-read` marker for the cases that argue for themselves |
| 7 | Audit | **Verified** | Append-only with no delete and no content update, enforced by grants and by a row-level trigger that covers the owner (`migrations/0080`). Chained behind the write path by `audit/chainer.ts` since P7-T02a, with `pnpm audit:verify` counting unchained rows as pending rather than verified. `audit-chainer.test.ts` and `operation-pipeline.test.ts` |
| 8 | Freeze | **Verified** | `operations/freeze.ts` collapses a non-active workspace to view-only, `isRecoveryAction` keeps the admin list reachable, and `/admin/general` has the switch since P6-G25 |
| 9 | Secrets | **Verified** | The environment schema names each variable and production refuses placeholder values (`config/src/env.ts:34-37,80-81`). Envelope encryption through a key ring, and `pnpm keys:rotate` re-wraps data keys onto a new root |
| 10 | Outbound requests | **Verified** | `adapters/src/outbound/guard.ts`. §8.2 records the three decisions that matter: every resolved address rather than the first, a literal address skips the resolver, and the size cap is on what arrives rather than on the declared length |
| 11 | API tokens | **Verified** | `api/tokens.ts` and `actions/api-tokens.ts`: scoped, expiring, hashed at rest, last-used recorded, and a token-authenticated caller cannot administer tokens |
| 12 | Channel inbound | **Verified** | Signature verification in all four drivers (`drivers/channel/{slack,teams,telegram,whatsapp}.ts`, `timingSafeEqual`). `channels/inbound.ts` is the six-step ladder: unknown senders get silence, and steps four and five answer with silence deliberately |
| 13 | Agents | **Verified** | Least-privilege bindings on named spaces and goals, no workspace-wide grant, read/write/destructive classes, sandbox and proposal modes, cost caps. P7-T04 is the suite that proves the injected-instruction case |
| 14 | Privacy | **Absent** | Export and erasure are P7-T08 and nothing is built. Not a finding: the plan schedules it |
| 15 | Supply chain | **Verified** | CodeQL (`codeql.yml`), dependency review (`dependency-review.yml`), a pinned lockfile, keyless cosign signing with an OIDC token and no stored private key (`release.yml:69-82`), an SBOM (`release.yml:126`), `pnpm check:licences`, and `pnpm check:signoff` |
| 16 | Operator access | **Absent** | Cloud only, and Phase 8. Not a finding |

## Findings

Two stand and one was withdrawn. Both survivors are "§8.2 promises something
the code does not do". Neither is a vulnerability found by probing; each is a
gap between the document and the build, which is exactly what an audit against
a checklist is for.

### F-1: no rate limit on the export download route

**Narrowed from what this first claimed.** The first pass said the REST
surface had no limiter, having searched `packages/core` for one that lives in
`apps/web`. It is there: `app/api/v1/[[...path]]/route.ts:120` limits per
token rather than per member, and says why, so two services sharing one
member's authority cannot starve each other. The device-login route has one
too.

What is genuinely unlimited is `app/api/exports/[id]/download/route.ts`. It
resolves the caller's own session and answers not-found for somebody else's
export, so it is authorised correctly, and it does not pass through the `/api/v1`
handler that carries the limiter.

**Severity: low.** A caller can only re-download their own finished exports, so
this is bandwidth rather than disclosure, and every request still costs them a
session. It is on the list because §8.2 names exports explicitly and because an
export is the largest response the product serves.

**Fixed in this change.** Twenty downloads a minute keyed on the member, using
the same `getCache().rateLimit` the REST route calls. Keyed on the person
rather than the export, because a loop over twenty different exports is the
same load as a loop over one.

### F-2: uploaded images are not re-encoded

§8.2 says "upload type and size allow-list, images re-encoded". The allow-list
and the ceiling are real and SVG is correctly excluded. Re-encoding is not
implemented: an accepted PNG or JPEG is stored and served as the bytes that
arrived.

**Severity: medium.** The allow-list is checked against the declared content
type. A file that claims `image/png` and carries something else reaches
storage, and whether that matters depends on what opens it later. Re-encoding
is the control that makes the claim true rather than trusted.

**Fix:** decode and re-encode on upload, which needs an image library and is
therefore a new runtime dependency and Agung's call. A cheaper partial step
that needs no dependency is to verify the magic bytes against the declared
type and refuse a mismatch, which closes the lie without normalising the file.

### F-3: withdrawn

**This was written as a finding and it was wrong.** The first pass searched
`boundaries.ts` for the words "raw read" and found nothing, and concluded the
lint §8.2 names did not exist. It does:
`protected-read-outside-getter` at `config/src/boundaries.ts:573`, with an
`allow-raw-read` marker above the line for a read that argues for itself, and
its own note about anchoring on the `.from(...)` line because walking back to
the statement start lands on the closing brace of the `.select({...})`
argument instead.

Recorded rather than deleted, because a withdrawn finding is worth as much as
a real one to whoever reads this next: the lint exists, and searching for a
document's phrasing rather than for the behaviour is how an audit invents a
gap.

## What this audit did not cover

Stated so the next reader does not mistake silence for a pass.

- **No probing.** Nothing here was tested by attacking a running instance. The
  tenant floor is the exception: P7-T03a fuzzes it and includes a mutation
  check proving the suite can fail.
- **Headers were read, not fetched.** `proxy.ts` sets them; nobody has
  confirmed what a response carries through the deployed reverse proxy, which
  is `deploy/docker`'s own configuration and a different question.
- **Dependency scanning is CI-only.** CodeQL and dependency review cannot run
  on this machine, so rows 15's first two entries are verified by reading the
  workflow rather than by seeing it pass.
- **Rows 14 and 16 are unbuilt by plan**, not missed.
