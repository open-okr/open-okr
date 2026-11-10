# Hardening batch, November 2026

Status: design approved 2026-11-10 (simplified per owner guidance). Covers the open security findings of the 2026-11-08 readiness review that need a design first (CLAUDE.md: changes to security or access). One commit per row of the table below.

| Change | Findings | What changes | Size |
|---|---|---|---|
| H-A Origin check | SEC-6, SEC-7 | One shared check for every route handler that authenticates with the session cookie and changes something: the request's `Origin` (or `Referer` when Origin is absent) must equal the instance origin, else 403. Bearer-token and webhook routes are exempt, because they carry no cookie. The OAuth consent route (`/oauth/authorize/decide`) also checks `redirectUri` against the client's registered URIs on both approve and deny, and refuses an unregistered one without redirecting | S |
| H-B Database role and public detail | SEC-9, SEC-13 | No refusal to start. When the database role is a superuser or has BYPASSRLS, the existing log warning stays and the admin Instance page also shows a notice saying tenant isolation is off and how to fix it. `/api/health` keeps `status` and drops `scheduler` and `tenantFloor` for an anonymous caller. `/api/metrics` is unchanged, so no existing scraper breaks | S |
| H-C Outbound pinning | SEC-4, SEC-5 | The outbound guard connects to the address it checked, through an undici `Agent` whose `connect.lookup` returns only checked addresses, so a name cannot resolve to a public address for the check and a private one for the connection. SSO discovery, token and userinfo URLs are checked with `checkUrl` when saved and again before use, and Better Auth's SSO fetches go through the guarded fetch where its options allow; where they do not, the save-time check stands and `docs/admin/security.md` says so | M |
| H-D Setup claim | SEC-10 | No claim code: it adds a step to every install and confuses people who follow an older guide. Instead the install guides say to finish `/setup` right after the first start, and `./openokr up` prints the setup link with that advice | S |

## Rules every change keeps

- No new dependency. undici ships with Node.
- Every refusal is a plain 403 or a form error with catalogue text, never a stack trace.
- Each change has unit tests and, where a person sees it (H-D), an end-to-end spec.

## Acceptance criteria

- H-A: Given a signed-in admin, When a cross-site page posts to `/api/v1/admin/sso`, Then it is refused with 403. Given the consent route with a `redirectUri` the client did not register, When deny is posted, Then no redirect happens.
- H-B: Given a BYPASSRLS role, When an admin opens the Instance page, Then a notice explains that tenant isolation is off and links to the fix. The server still starts. Given an anonymous request to `/api/health`, Then the body is `{ "status": "ok" }`.
- H-C: Given a name that resolves public on the first lookup and private on the second, When the guarded fetch runs, Then the connection goes to the public address or is refused, never to the private one.
- H-D: Given `./openokr up` on a fresh install, Then it prints the setup link and says to finish setup now.

## Owner guidance (2026-11-10)

"Not complicated, not too strict, nothing that confuses users." So: nothing in this batch adds a step for a person or can stop an instance from starting. H-A and H-C change nothing a person sees. H-B only adds a notice for admins. H-D only adds a printed hint.
