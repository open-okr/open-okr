# Sign-in rate limits that hold across servers

Status: design approved 2026-11-10. Follows the 2026-11-08 readiness review (REL-2, SEC-11, SEC-12).

Better Auth limits sign-in attempts per caller address. Today the counters live in each server process, and the caller address is read from a header a proxy may have appended to. Three problems follow:

| Problem | Effect |
|---|---|
| Counters are per process | With three replicas a caller gets three times the limit. A restart forgets every counter |
| `X-Forwarded-For` with more than one address falls into one shared "unresolved" bucket | Behind a proxy that appends, every caller shares one limit, so ten bad attempts from anyone block sign-in for everybody |
| Limits are per address only | A password spray from many addresses is never slowed for the account it targets |

## Design

| # | Change | Where |
|---|---|---|
| 1 | Better Auth's `rateLimit.customStorage` is backed by the existing cache port. Its Postgres driver (`cache_entries`, migration 0002) is shared by every replica and survives a restart. No migration | `packages/core/src/auth/auth.ts`, `packages/adapters` cache port |
| 2 | New setting `OPENOKR_TRUSTED_PROXY_HOPS`, default `1`: the number of proxies in front of the server. The caller is the address that many entries from the right of `X-Forwarded-For`. `0` means no proxy, so the header is ignored and the caller is unresolved | `packages/core/src/auth/caller-address.ts`, `packages/config/src/env.ts`, TECHNICAL-PLAN §4.14 |
| 3 | A per-account limit on failed password sign-ins: after 10 failures for one email in 15 minutes, password sign-in for that email is refused for the rest of the window with the existing "too many attempts" message. A success clears the count. Passkeys, single sign-on and password reset are not counted | Better Auth after-hook on the sign-in path, cache `incr` |
| 4 | The rule named `/forget-password` is renamed to `/request-password-reset`, the route Better Auth 1.7 serves | `auth.ts` |
| 5 | The install guides say how many proxies each shipped topology has: Compose with Caddy is 1, Helm behind one ingress controller is 1, a cloud load balancer in front of the ingress is 2 | `docs/install/compose.md`, `docs/install/kubernetes.md`, Helm values |

Why `1` by default: both shipped topologies put exactly one proxy in front of the server, and a default that is right for them means nobody has to configure anything (CLAUDE.md, settings rule). The rightmost entry is the one the nearest proxy wrote, so a client cannot spoof it by sending its own header.

Why a lockout window and not a permanent lock: a permanent lock lets anybody who knows an email address lock its owner out. Fifteen minutes slows a guessing attack to 40 tries an hour per account and costs the real owner at most one window.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `OPENOKR_TRUSTED_PROXY_HOPS` | `1` | Proxies in front of the server |
| `auth.accountFailureLimit` | `10` | Failed password sign-ins per email per window |
| `auth.accountFailureWindowMinutes` | `15` | The window |

The two `auth.*` values go in the TECHNICAL-PLAN §4.14 map with these defaults. They are instance settings, not METHOD.md thresholds, because they are about security, not OKR practice.

## Acceptance criteria

- Given two server processes sharing one database, When a caller makes 10 failed sign-ins split across both, Then the 11th on either is refused.
- Given a server restart, When the caller who hit the limit tries again inside the window, Then it is still refused.
- Given `OPENOKR_TRUSTED_PROXY_HOPS=1` and `X-Forwarded-For: 203.0.113.9, 198.51.100.4`, When the caller is resolved, Then it is `198.51.100.4`, and two callers with different rightmost entries have separate limits.
- Given `OPENOKR_TRUSTED_PROXY_HOPS=2` and the same header, Then the caller is `203.0.113.9`.
- Given 10 failed password sign-ins for `a@example.com` from 10 addresses, When an 11th address tries the right password inside the window, Then it is refused, and after the window it succeeds.
- Given 9 failures and then a success, When the next failure comes, Then the count starts again from 1.
- Given a password reset request, Then it is limited by the existing per-address rule under its real route name.

## Not in this change

- CAPTCHA or proof of work.
- Notifying the account owner of repeated failures.
- Limits on the REST API and MCP endpoints, which have their own.

## Decisions (2026-11-10)

| # | Question | Decision |
|---|---|---|
| 1 | Default `OPENOKR_TRUSTED_PROXY_HOPS` | `1`. The cloud operator confirms the hop count of okrgoal.com during the cloud launch checklist and sets `2` if a load balancer sits in front of the ingress |
| 2 | Per-account limit | 10 failed password sign-ins per email per 15 minutes |
