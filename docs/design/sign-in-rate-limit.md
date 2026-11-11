# Sign-in rate limits that hold across servers

Status: design approved 2026-11-10. **Narrowed the same day:** items 1, 3 and 4 below were already delivered by [account-lockout.md](account-lockout.md) (P10a/P10b, commit 914d63c5), so this change builds item 2 and item 5 only. Follows the 2026-11-08 readiness review (REL-2, SEC-11, SEC-12).

Better Auth limits sign-in attempts per caller address. Today the counters live in each server process, and the caller address is read from a header a proxy may have appended to. Three problems follow:

| Problem | Effect |
|---|---|
| Counters are per process | With three replicas a caller gets three times the limit. A restart forgets every counter |
| `X-Forwarded-For` with more than one address falls into one shared "unresolved" bucket | Behind a proxy that appends, every caller shares one limit, so ten bad attempts from anyone block sign-in for everybody |
| Limits are per address only | A password spray from many addresses is never slowed for the account it targets |

## Design

| # | Change | Where |
|---|---|---|
| 1 | **Already delivered by account-lockout.md D10.** Better Auth's `rateLimit.customStorage` is backed by the existing cache port. Its Postgres driver (`cache_entries`, migration 0002) is shared by every replica and survives a restart. No migration | `packages/core/src/auth/auth.ts`, `packages/adapters` cache port |
| 2 | New setting `OPENOKR_TRUSTED_PROXY_HOPS`, default `1`: the number of proxies in front of the server. The caller is the address that many entries from the right of `X-Forwarded-For`. `0` means no proxy, so the header is ignored and the caller is unresolved | `packages/core/src/auth/caller-address.ts`, `packages/config/src/env.ts`, TECHNICAL-PLAN §4.14 |
| 3 | **Already delivered by account-lockout.md D2 to D8 and D14, with different numbers (see Decisions).** A per-account limit on failed password sign-ins: after 10 failures for one email in 15 minutes, password sign-in for that email is refused for the rest of the window with the existing "too many attempts" message. A success clears the count. Passkeys, single sign-on and password reset are not counted | Better Auth after-hook on the sign-in path, cache `incr` |
| 4 | **Already delivered by account-lockout.md D11.** The rule named `/forget-password` is renamed to `/request-password-reset`, the route Better Auth 1.7 serves | `auth.ts` |
| 5 | The install guides say how many proxies each shipped topology has: Compose with Caddy is 1, Helm behind one ingress controller is 1, a cloud load balancer in front of the ingress is 2 | `docs/install/compose.md`, `docs/install/kubernetes.md`, Helm values |

Why `1` by default: both shipped topologies put exactly one proxy in front of the server, and a default that is right for them means nobody has to configure anything (CLAUDE.md, settings rule). The rightmost entry is the one the nearest proxy wrote, so a client cannot spoof it by sending its own header.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `OPENOKR_TRUSTED_PROXY_HOPS` | `1` | Proxies in front of the server |

`OPENOKR_TRUSTED_PROXY_HOPS` is an environment-only deployment value, with no stored setting. It is in the TECHNICAL-PLAN §4.14 map and in Helm as `instance.trustedProxyHops`. The per-account numbers are constants in `lockout.ts` (account-lockout.md D14), not settings.

## Acceptance criteria

- Given `OPENOKR_TRUSTED_PROXY_HOPS=1` and `X-Forwarded-For: 203.0.113.9, 198.51.100.4`, When the caller is resolved, Then it is `198.51.100.4`, and two callers with different rightmost entries have separate limits.
- Given `OPENOKR_TRUSTED_PROXY_HOPS=2` and the same header, Then the caller is `203.0.113.9`.
- Given `OPENOKR_TRUSTED_PROXY_HOPS=0`, Then the header is ignored and every caller shares one unresolved limit.
- Given the setting is absent, Then it is 1, and a Helm release upgraded with `--reuse-values` from before the key existed renders 1.

The shared counters, the restart behaviour, the per-account hold, its reset on success and the renamed reset rule are covered by account-lockout.md and its tests (`auth-rate-limit-shared.test.ts`, `sign-in-lockout.test.ts`, `lockout-curve.test.ts`).

## Notes on the build

- Better Auth's limiter can trust a list of networks but not a number of hops. The handler resolves the caller once, before the router, and passes it in a private header (`x-openokr-caller`) that Better Auth is told to read. The header is always replaced or removed there, so one a caller sends never survives.
- `X-Real-IP` is read only when there is no `X-Forwarded-For` and the setting is 1. With more proxies it names an inner proxy, and with none the caller wrote it.
- Fewer `X-Forwarded-For` entries than proxies is unresolved.

## Not in this change

- CAPTCHA or proof of work.
- Notifying the account owner of repeated failures.
- Limits on the REST API and MCP endpoints, which have their own.

## Decisions (2026-11-10)

| # | Question | Decision |
|---|---|---|
| 1 | Default `OPENOKR_TRUSTED_PROXY_HOPS` | `1`. The cloud operator confirms the hop count of okrgoal.com during the cloud launch checklist and sets `2` if a load balancer sits in front of the ingress |
| 2 | Per-account limit | **Superseded by account-lockout.md D14:** 5 failures per address and account, 20 per account, hold 1 to 15 minutes, constants rather than settings. The 10 in 15 minutes proposed here is not built |
