# Trusted proxies: whose address a request is counted under

Status: proposed 10 November 2026 for release 0.8.0 (plan H2, section 3.1). **Approved by Akmal on 11 November 2026, Q1 to Q3 as recommended.** Built on 11 November 2026; §9 lists where the build differs. It changes how every per-address limit and the sign-in hold identify a caller, so it is designed first (CLAUDE.md: security).

Behind a CDN and a load balancer the instance cannot tell one caller from another. This design lets an operator name the proxies in front of the instance, or the one header their CDN writes, so the caller's address is read the way Better Auth already knows how to read it, and every limit counts people rather than proxies.

## 0. What exists

Better Auth paths are in the installed 1.7.18. `@better-auth/core` means `node_modules/@better-auth/core/dist`; `better-auth` means `node_modules/better-auth/dist`.

| Piece | Where | Today |
|---|---|---|
| The resolver | `packages/core/src/auth/caller-address.ts` (`CALLER_ADDRESS_HEADERS`, `callerAddress`) | Calls Better Auth's `getIP` with the headers `x-forwarded-for` then `x-real-ip` and no `trustedProxies`. Each header is believed only when it holds exactly one well-formed address. Anything else returns `unresolved` |
| Better Auth's own configuration | `packages/core/src/auth/auth.ts:521-528` | `advanced.ipAddress.ipAddressHeaders` is the same list. `trustedProxies` is not set |
| How Better Auth reads a header | `@better-auth/core/utils/ip.mjs:174-195` (`getIPFromHeader`) | Without `trustedProxies`: one value or nothing (`:190`). With it: the comma-separated chain is walked from the right, entries inside a trusted range are skipped, and the first entry outside every range is the caller. A non-address met before that, or a chain that is trusted all the way, gives nothing. It applies to **every** header in the list, not only `X-Forwarded-For` |
| Which header wins | `@better-auth/core/utils/ip.mjs:203-219` (`getIP`) | Tries each listed header in order and takes the first that gives an address. A header that gives nothing passes the turn to the next one. In development and test it answers `127.0.0.1` rather than nothing |
| A bad range | `better-auth/context/create-context.mjs:91-95` | Logged as a warning and **ignored**. The rest of the list still applies |
| The option's own warning | `@better-auth/core/types/init-options.d.mts:268-282` | "This only interprets the forwarded header chain and cannot verify the direct sender. It is safe only when your origin is reachable through these proxies" |
| The socket address | Next.js route handlers | Not available. A handler is given a web `Request`, which carries headers and no peer address. So "trusted" can only ever mean "a hop the operator named", never "the machine that connected" |
| Better Auth's limiter | `better-auth/api/rate-limiter/index.mjs:236-248` | No address means the key `no-trusted-ip\|<path>`: one shared bucket per path for every unplaced caller, and one warning per process ("Rate limiting could not determine a client IP...") |
| Session rows | `better-auth/db/internal-adapter.mjs:288` | `ipAddress: getIP(...) \|\| ""`. Unplaced callers get an empty string. `apps/web/app/account/security/sessions.tsx:86` hides an empty address |
| The sign-in hold | `auth.ts:592`, `:705`; `packages/core/src/auth/lockout.ts:86-95` | The pair counter is keyed on an HMAC of `callerAddress()` (account-lockout.md D2, D5) |
| The 429 audit row | `apps/web/app/api/auth/[...all]/route.ts:47-52` | `auth.rate_limited` records `callerAddress(request.headers)` |
| The public doors | `apps/web/app/api/v1/cli/device/route.ts:54`, `apps/web/app/api/mcp/register/route.ts:62`, `apps/web/app/api/mcp/token/route.ts:91` | Rate limits keyed `device:start:`, `oauth:register:`, `oauth:token:` plus `callerAddress()` |
| What pins today's rule | `packages/core/test/caller-address.test.ts`, `apps/web/test/public-door-limits.test.ts:455`, `apps/web/test/auth-route.test.ts:130` | A chain is unresolved; X-Real-IP is the fallback. `e2e/hosting.ts:50-75` gives each person one `X-Forwarded-For` address, which keeps working under every decision below |
| The shipped proxies | `deploy/docker/Caddyfile:45-60`, `deploy/docker/compose.yaml` (`app` has `expose: 3000`, no published port); `deploy/helm/values.yaml:123-133` (`service.type: ClusterIP`, ingress off by default) | Caddy trusts no upstream, so it **replaces** whatever `X-Forwarded-For` the caller sent with the one address it saw. The chart brings no proxy; the ingress controller is the operator's |

### 0.1 What each topology gets today

Addresses are from the documentation ranges: the person is `198.51.100.7`, an address a caller invented is `203.0.113.66`, a Cloudflare edge is `172.70.1.2`.

| Topology | `X-Forwarded-For` the app receives | Caller today |
|---|---|---|
| Compose, Caddy on the internet | `198.51.100.7` (Caddy replaced anything sent) | Correct |
| Compose, a CDN in front of Caddy | `172.70.1.2` (Caddy replaced the CDN's chain with the edge it saw) | Every visitor counted as one of a few edge addresses. **No warning**, because an address was found |
| Kubernetes, an ingress controller that writes one address, behind a layer-4 load balancer that keeps the source | `198.51.100.7` | Correct |
| Kubernetes, an ingress controller that replaces the header, behind a layer-7 load balancer | The load balancer's address | Every visitor shares it. No warning |
| AWS ALB straight to pods, no CDN | `198.51.100.7`, or `203.0.113.66, 198.51.100.7` when the caller sent a header (the ALB appends by default) | Correct until a caller sends a header. Then the chain is refused and **X-Real-IP is read** (0.2) |
| Cloudflare, then an AWS ALB, then pods (OKRGoal) | `198.51.100.7, 172.70.1.2`, always a chain | `unresolved` for everybody, in every limit and the hold. Sessions record no address |

### 0.2 What the plan row understates

1. **The X-Real-IP fallback lets a caller choose their address.** When `X-Forwarded-For` is a chain it gives nothing, so `getIP` reads `X-Real-IP`. An AWS ALB appends to `X-Forwarded-For` and leaves `X-Real-IP` as the caller sent it. A caller who reaches the ALB directly and sends `X-Forwarded-For: anything` plus `X-Real-IP: <new address each time>` is counted under whatever they wrote, so no per-address limit holds them at all. Cloudflare strips a visitor's `X-Real-IP` on ordinary requests (its HTTP headers reference, under `CF-Connecting-IP`), so on OKRGoal this needs the ALB to be reachable without Cloudflare, which nothing in the product prevents. The plan row says the second header "cannot help"; it is worse than that. One `curl` against the ALB's own hostname settles whether OKRGoal is exposed today.
2. **The sign-in hold becomes per account, for everybody.** The pair counter (account-lockout.md D2) is keyed on the email and `callerAddress()`. When every caller is `unresolved`, five wrong passwords from anybody hold that account's password sign-in for everybody, and the known-address exemption (D4) never helps, because the attacker's address and the person's are the same string.
3. **Two shared keys, not one.** Better Auth's limiter uses `no-trusted-ip`; the hold, the audit row and the public doors use `unresolved`. Same effect, two names.
4. **A CDN's published ranges are shared by all its customers.** Cloudflare's own pages say its ranges are "shared by all proxied hostnames", that its default origin certificate "only guarantees that a request is coming from the Cloudflare network", and that a Worker fetching a host outside Cloudflare "controls the client IP headers". So with an ALB anyone can reach, trusting Cloudflare's ranges trusts hops that other Cloudflare customers' traffic also arrives from. Whether that traffic can write the left of the chain is not something Cloudflare documents, and this design has not tested it. Trusting the ranges is only safe with the origin locked to your own zone, and then the CDN's own header is simpler and carries no such doubt (Q3).

## 1. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **Two settings, environment only.** `network.trustedProxies` from `OPENOKR_TRUSTED_PROXIES`, and `network.clientAddressHeader` from `OPENOKR_CLIENT_ADDRESS_HEADER`. Both empty by default. Declared in the environment schema in `packages/config/src/env.ts` and listed in TECHNICAL-PLAN §4.14 as environment only, like `OPENOKR_METRICS_TOKEN` and `OPENOKR_ERROR_DSN`. Not in `INSTANCE_SETTINGS` and not in `system_settings`, and no screen sets them | They describe the network in front of the instance, which the product cannot see. Better Auth reads them off an options object built once per process, and every replica must agree. A setting a signed-in administrator could change from a browser is a way to switch off every per-address limit from a stolen session; whoever can change the environment can already change the image |
| D2 | **Empty means today's rule**: `X-Forwarded-For` is believed only when it holds one address, and anything else is `unresolved`. Whether `X-Real-IP` stays as a fallback is Q1 | Nothing to configure on the shipped Compose with Caddy on the internet, which already works. An install that sets nothing never believes more than it does today |
| D3 | **Ranges mode.** With `network.trustedProxies` set, only `X-Forwarded-For` is read. The chain is walked from the right; a hop inside a named range is skipped; the first address outside every range is the caller. A chain trusted all the way, or a non-address reached first, is `unresolved`. This is Better Auth's own `getIPFromHeader`, not a second parser | The entries a caller can write are always on the left, so they are reached only by passing every hop the operator named. One reader means Better Auth's limiter, the session row and `callerAddress()` cannot disagree |
| D4 | **Header mode.** With `network.clientAddressHeader` set, only that header is read, and only when it holds one address. `X-Forwarded-For` and `X-Real-IP` are not read. A request without it is `unresolved`. **Safe only when the origin refuses every request that did not come through your own CDN zone**: a tunnel, client certificates of your own, or a secret header your zone adds and your load balancer requires. Allowing the CDN's address ranges is not enough (0.2, item 4) | A CDN header such as `CF-Connecting-IP` holds exactly the visitor, so nothing has to be walked. But anyone who reaches the origin some other way can write it |
| D5 | **Not both.** Setting both refuses the boot, naming both variables | Better Auth would apply the ranges to the header's single value, which means nothing useful. Two modes that look combinable invite a configuration nobody can reason about |
| D6 | **What an entry is**: an IPv4 or IPv6 address, or a range in CIDR form (`10.0.1.0/24`, `2606:4700::/32`), separated by commas, spaces or newlines. An IPv4 range also matches the IPv4-mapped IPv6 form a proxy may write (`::ffff:10.0.1.5`), because Better Auth maps them before matching. No host names | A host name would need a DNS lookup per request, or a cache that goes stale, and an air-gapped instance may have no resolver. IPv6 callers are still folded to their /64 for every key, Better Auth's default, unchanged |
| D7 | **Refused at boot, naming the entry**: anything that is not an address or a range; `0.0.0.0/0` or `::/0`; an IPv4-mapped IPv6 range (write it as IPv4); a header name that is not an HTTP token; `x-forwarded-for` as the header (the message says to name proxies instead); both variables set. Unlike a credential, a range is not secret, so the message repeats the bad entry | Better Auth drops a bad entry and carries on (0). A dropped range turns that proxy into "the caller", so every visitor through it shares one count, silently. Trusting everything lets every caller choose their address. Both are mistakes to stop before the first request |
| D8 | **One parser, one configuration.** `packages/config` exports the parse of the two variables, and the environment schema uses it, so the boot check and the running reading are the same code. `packages/core` turns the result into Better Auth's `advanced.ipAddress` block in one function, `callerAddressOptions()`. `createAuth` passes that block to Better Auth, and `callerAddress()` passes the same block to Better Auth's `getIP` as it does today. Derived from the environment where it is used, not installed by a boot step | Two parsers of one header are two answers to "who is calling" (the reason `caller-address.ts` exists). A route bundle can hold its own copy of a module, which is why `env.ts` keeps the build id on `globalThis`; a value installed at boot might not be the one a route sees |
| D9 | **Every consumer follows, nothing else changes.** Better Auth's limiter, the session row, the hold's pair key, the `auth.rate_limited` row and the three public doors all read the address D3 or D4 resolves. No migration. Pair rows keyed on `unresolved` age out under the hold's existing 30-day purge | Each already asks the one resolver. After an upgrade a person has no known address until they next sign in, which is the ordinary state for a new network |
| D10 | **Said at boot.** One log line with the effective reading, never anything secret: `caller address: X-Forwarded-For, trusting 22 ranges`, `caller address: the cf-connecting-ip header only`, or `caller address: one forwarded address only` | An operator reading the log after a deployment can see which reading is in force without opening a shell |
| D11 | **Audited on change.** At boot, inside one transaction holding the instance chain's advisory lock (`instance-chain.ts`), the process reads the newest `instance.caller_address_configured` row and appends one only when the effective reading differs: `{ mode: "single_address" \| "trusted_proxies" \| "header", trustedProxies: [sorted], header }`. The first boot after the upgrade records the starting point. Several replicas booting together write one row. A failure is logged and does not stop the boot. Skipped during `next build` | The reading decides whether every per-address limit works, so "when did that change" belongs on the chain. The lock that already serialises appends makes it exactly once, with no new table or setting row. There is no actor, because the deployment changed it, which the row says by having none |
| D12 | **Seen while running.** `callerAddress()` counts `openokr_caller_addresses_total{outcome="resolved"\|"unresolved"}`. On a self-hosted instance, Admin, General shows a notice beside the tenant-floor notice (`instance-health-notice.tsx`) when this process has counted any unresolved caller since it started: what it means and which variable to set, linking to the install guide. Hidden on a managed cloud, whose operator reads the metric and the log. Better Auth's own once-per-process warning stays | A correct deployment never produces an unresolved caller: Caddy always writes one address, and a correct list always reaches one. Changing either variable means a restart, which also clears the count, so the notice goes away when the fix lands |
| D13 | **The managed-cloud flag changes nothing** but D12's notice | The network in front is a fact about the deployment, not about who its customers are |
| D14 | **Compose.** The operator writes the variable in `secrets/app.env`, which the application already reads. `./openokr up` and `upgrade` also hand `OPENOKR_TRUSTED_PROXIES` to the `proxy` service, space separated, and the Caddyfile's global options read it: `servers { trusted_proxies static {$OPENOKR_TRUSTED_PROXIES:127.0.0.1/32} }`. Header mode needs nothing from Caddy | Caddy ignores a forwarded header from anyone it does not trust and adds to it for those it does. So the one line makes Caddy keep the chain from the proxies named and makes the application read it, and editing the shipped Caddyfile, which an upgrade replaces, is never needed. The loopback default trusts nothing that can reach Caddy |
| D15 | **Helm.** `network.trustedProxies: []` and `network.clientAddressHeader: ""` in `values.yaml`, rendered as the two variables only when set (the list joined by commas). `_validate.tpl` refuses both set and refuses `0.0.0.0/0` and `::/0` at template time | The chart's rule: a configuration it can see is wrong fails before anything reaches the cluster |
| D16 | **Never fetched.** No range list is downloaded, at boot or ever. The operator supplies the ranges; the install guide shows Cloudflare's as an example with where to get the current list (Q2) | An air-gapped instance has no route to a CDN's website, and a list that changes underneath a running instance is a security setting nobody chose |

### 1.1 The reading, worked through

| What arrives | Setting | Caller |
|---|---|---|
| `X-Forwarded-For: 198.51.100.7` | Nothing set | `198.51.100.7` |
| `X-Forwarded-For: 203.0.113.66, 198.51.100.7` | Nothing set | `unresolved` |
| `X-Forwarded-For: 198.51.100.7, 172.70.1.2` | Cloudflare's ranges | `198.51.100.7` |
| `X-Forwarded-For: 203.0.113.66, 198.51.100.7, 172.70.1.2` | Cloudflare's ranges | `198.51.100.7`. The caller's own entry is never reached |
| `X-Forwarded-For: 172.70.9.9, 172.70.1.2` | Cloudflare's ranges | `unresolved`: every hop is trusted |
| `X-Forwarded-For: 198.51.100.7:51234, 172.70.1.2` | Cloudflare's ranges | `unresolved`: a port makes it not an address |
| `X-Forwarded-For: 2001:db8:1:2::7, 2606:4700::1` | Cloudflare's ranges | `2001:0db8:0001:0002:0000:0000:0000:0000` (the /64) |
| `X-Forwarded-For: 203.0.113.66, 198.51.100.7` | `10.0.1.0/24` (an ALB's subnet) | `198.51.100.7`. The nearest proxy's own address never appears in the chain; naming it is what turns the walk on |
| `CF-Connecting-IP: 198.51.100.7`, `X-Forwarded-For: 203.0.113.66` | Header `cf-connecting-ip` | `198.51.100.7` |
| No `CF-Connecting-IP`, `X-Forwarded-For: 198.51.100.7` | Header `cf-connecting-ip` | `unresolved` |

## 2. What an operator sets, per topology

The check is the same everywhere: sign in from a phone on mobile data and open `/account/security`. The session shows the address this instance resolved. It should be the phone's public address, not the CDN's, the load balancer's, or nothing.

| Topology | Set | Notes |
|---|---|---|
| Compose, Caddy on the internet | Nothing | Today's behaviour |
| Compose, behind a load balancer you run | `OPENOKR_TRUSTED_PROXIES=10.0.1.0/24` in `secrets/app.env` | The load balancer's own addresses. `./openokr up` hands the same list to Caddy (D14) |
| Compose, behind Cloudflare | `OPENOKR_CLIENT_ADDRESS_HEADER=cf-connecting-ip`, with the server reachable only through your zone. Cloudflare Tunnel is the simplest on one server: it opens no port at all | Ranges mode works too (Cloudflare's list in the same variable), with the same lock on the origin |
| Kubernetes, ingress controller behind a layer-4 load balancer that keeps the source address | Nothing, when the controller writes one address | Check the session address. If it shows the load balancer, use the next row |
| Kubernetes, ingress controller behind a layer-7 load balancer | Tell the controller to trust that load balancer and add to the header (its own setting), then `network.trustedProxies` with the load balancer's subnets | The controller's setting is outside this product; the install guide names the knob for the common controllers without promising their defaults |
| AWS ALB straight to pods (AWS Load Balancer Controller, `target-type: ip`) | `network.trustedProxies` with the ALB's subnets | Leave `routing.http.xff_client_port.enabled` off, its default: a port in the chain makes every caller `unresolved` |
| Cloudflare, then an AWS ALB, then pods | Recommended: `network.clientAddressHeader: cf-connecting-ip`, and an ALB that forwards only requests carrying a secret header your zone adds with a request header Transform Rule (or Authenticated Origin Pulls with a certificate of your own). Alternative: Cloudflare's ranges in `network.trustedProxies`, with the same lock | Q3 decides which the guide leads with |

Helm, Cloudflare plus ALB, recommended:

```yaml
network:
  clientAddressHeader: cf-connecting-ip
```

Helm, ranges mode. Cloudflare's list as published at `https://www.cloudflare.com/ips/` on 10 November 2026. **Copy the current one when you deploy**; the instance never fetches it.

```yaml
network:
  trustedProxies:
    # IPv4
    - 173.245.48.0/20
    - 103.21.244.0/22
    - 103.22.200.0/22
    - 103.31.4.0/22
    - 141.101.64.0/18
    - 108.162.192.0/18
    - 190.93.240.0/20
    - 188.114.96.0/20
    - 197.234.240.0/22
    - 198.41.128.0/17
    - 162.158.0.0/15
    - 104.16.0.0/13
    - 104.24.0.0/14
    - 172.64.0.0/13
    - 131.0.72.0/22
    # IPv6
    - 2400:cb00::/32
    - 2606:4700::/32
    - 2803:f800::/32
    - 2405:b500::/32
    - 2405:8100::/32
    - 2a06:98c0::/29
    - 2c0f:f248::/32
```

Compose, behind a load balancer at `10.0.1.0/24`:

```
# deploy/docker/secrets/app.env
OPENOKR_TRUSTED_PROXIES=10.0.1.0/24
```

## 3. Security considerations

| Risk | What stops it | What is left |
|---|---|---|
| A caller writes `X-Forwarded-For` | Ranges mode walks from the right, so the caller's entries are reached only past every named hop. With nothing set, a chain is refused | A caller whose own address is inside a named range can choose an address. The guide says to name your proxies' own addresses, not a broad private range that also holds people (Better Auth's option text says the same) |
| A caller skips the proxies and reaches the origin | Ranges mode: the nearest proxy appends or replaces with the address it really saw, so skipping the CDN gets the caller counted as themselves | Header mode is spoofable unless the origin is locked to your zone (D4). The product cannot check that. The guide says so in the first sentence of the Cloudflare section, and the deployment check below tests it |
| Trusting a CDN's shared ranges | D4, Q3 | Every customer of that CDN sends from those ranges. With an origin anyone can reach, whether their traffic can write the left of the chain is undocumented (0.2, item 4) |
| A typo in a range | D7 refuses the boot | Better Auth alone would have dropped it and warned once |
| Trusting everything | `0.0.0.0/0` and `::/0` refused at boot and by the chart | A very wide real range, such as `10.0.0.0/8` in a network where people sit, is allowed. It is a legitimate choice for some networks |
| A proxy writes ports, or a wrong list | Every caller is `unresolved`, which is today's shared count: the safe direction. D10's log line, D12's notice and metric, Better Auth's warning, and an empty session address all show it | The limits stay shared until the operator fixes it |
| Who changed it, and when | D11 writes one instance chain row per change of the effective reading | No actor: the environment has none. The deployment's own history (Helm values, the Compose host) says who |
| Personal data | Behind a CDN, `auth.rate_limited` rows and session rows start holding real addresses, as they already do on Compose. The hold still keeps HMACs only | The instance chain is append-only, so a 429's address stays. That is existing behaviour, made true for more deployments, not a new kind of record |

**The deployment check** (not a unit test, a step in the install guide and in OKRGoal's runbook): with the setting in place, send a sign-in request to the load balancer's own hostname, bypassing the CDN, carrying `CF-Connecting-IP: 203.0.113.66` and `X-Real-IP: 203.0.113.66`. In header mode it must be refused by the load balancer. In ranges mode it may arrive, and the resulting `auth.rate_limited` row or session must not show `203.0.113.66`.

## 4. Acceptance criteria

Resolution (unit, through `callerAddress()` and through Better Auth's `getIP` with the options `createAuth` builds):

- Given nothing set, when `X-Forwarded-For` is `198.51.100.7`, then the caller is `198.51.100.7`.
- Given nothing set, when `X-Forwarded-For` is `203.0.113.66, 198.51.100.7`, then the caller is `unresolved`.
- Given nothing set and Q1 answered "drop", when `X-Forwarded-For` is a chain and `X-Real-IP` is `203.0.113.66`, then the caller is `unresolved`, not `203.0.113.66`.
- Given Cloudflare's ranges, when `X-Forwarded-For` is `203.0.113.66, 198.51.100.7, 172.70.1.2`, then the caller is `198.51.100.7`.
- Given Cloudflare's ranges, when every entry is inside them, then the caller is `unresolved`.
- Given Cloudflare's ranges, when the entry left of the trusted hops is `198.51.100.7:51234`, then the caller is `unresolved`.
- Given ranges set, when `X-Real-IP` is `203.0.113.66` and `X-Forwarded-For` resolves nothing, then the caller is `unresolved`.
- Given an IPv4 range `10.0.1.0/24`, when the chain ends in `::ffff:10.0.1.5`, then that hop is skipped.
- Given header `cf-connecting-ip`, when it holds `198.51.100.7` and `X-Forwarded-For` holds `203.0.113.66`, then the caller is `198.51.100.7`; and when it is absent, then the caller is `unresolved`.
- Given any setting, for one request, Better Auth's `getIP` with `createAuth`'s options and `callerAddress()` return the same answer.

Boot (unit, `packages/config`):

- Given `OPENOKR_TRUSTED_PROXIES=10.0.1.0/24, cloudflare`, when the server boots, then it refuses with a message naming the variable and `cloudflare`.
- Given `0.0.0.0/0`, or `::/0`, or `::ffff:10.0.0.0/104`, then the boot is refused and the message says why.
- Given both variables set, then the boot is refused naming both.
- Given `OPENOKR_CLIENT_ADDRESS_HEADER=x-forwarded-for`, then the boot is refused and the message points to `OPENOKR_TRUSTED_PROXIES`.
- Given every entry the parser accepts in the test fixture list, when it is handed to Better Auth as `trustedProxies`, then Better Auth honours it (no entry the boot accepts is one Better Auth would drop).

Limits and records (integration, `createAuth` on a real database):

- Given Cloudflare's ranges, when caller A behind edge `172.70.1.2` makes ten sign-in attempts in a minute, then caller B behind the same edge is not refused on their first.
- Given the same, when caller A gets five wrong passwords for an account, then caller B's right password for that account succeeds.
- Given ranges set, when a session is created behind them, then its `ip_address` is the resolved caller.
- Given ranges set, when the limiter refuses with 429, then the `auth.rate_limited` row carries the resolved caller.

Audit and visibility:

- Given no `instance.caller_address_configured` row, when the server boots, then exactly one is appended with the effective reading.
- Given a row matching the current reading, when the server boots again, then none is appended; given a different reading, then one is.
- Given two processes booting at once with a changed reading, then exactly one row is appended.
- Given a self-hosted instance whose process has counted one unresolved caller, when an administrator opens Admin, General, then the notice is shown; given none, then it is not; given a managed cloud, then it is not.

Deployment:

- Given `network.trustedProxies` and `network.clientAddressHeader` both set, when the chart renders, then it fails with a sentence naming both.
- Given `network.trustedProxies: ["0.0.0.0/0"]`, when the chart renders, then it fails.
- Given a list, when the chart renders, then the pod has `OPENOKR_TRUSTED_PROXIES` with the entries joined by commas, and no variable when the list is empty.
- Given a fresh Compose install with nothing set, when `./openokr up` runs, then Caddy starts with the loopback default and a request through it resolves to the client, as today.
- Given `OPENOKR_TRUSTED_PROXIES` in `secrets/app.env`, when `./openokr up` runs, then the `proxy` container has the same ranges, space separated.

## 5. Tests

| Kind | File | Covers |
|---|---|---|
| Unit | `packages/core/test/caller-address.test.ts` (existing) | Every row of 1.1, the three modes, the mapped IPv4 case, Q1's answer |
| Unit | `packages/config/test/env.test.ts` (existing) | D6, D7: accepted forms, each refusal and its message, both set |
| Unit | `packages/core/test/caller-address-options.test.ts` | The Better Auth block per mode; the fixture list Better Auth honours; `getIP` and `callerAddress()` agree |
| Integration | `packages/core/test/auth-rate-limit-shared.test.ts` (existing) | Two callers behind one trusted edge get two counts |
| Integration | `packages/core/test/sign-in-lockout.test.ts` (existing) | Pair counters separate behind one trusted edge |
| Integration | `packages/core/test/caller-address-audit.test.ts` | D11: first boot, unchanged, changed, two at once |
| Unit | `apps/web/test/auth-route.test.ts`, `apps/web/test/public-door-limits.test.ts` (existing) | The chain cases updated for the chosen mode; the doors key on the resolved caller |
| Unit | `apps/web/test/instance-health-notice.test.tsx` | D12: shown, hidden, hidden on a cloud |
| End to end | `e2e/s36-caller-address-notice.spec.ts` | A sign-in carrying `X-Forwarded-For: 203.0.113.66, 198.51.100.7` (unresolved with nothing set), then Admin, General shows the notice. The e2e server runs with nothing set, so `e2e/hosting.ts`'s one address per person keeps working; the notice stays up for the rest of that shard's run, and no spec checks the instance notices today |
| Deployment | `deploy/helm/check.sh` | D15's refusals and rendering |
| Deployment | `deploy/docker/smoke-test.sh` | D14: Caddy starts with and without a list, and the proxy carries it |

## 6. Questions for Akmal

**Q1. Should `X-Real-IP` still be read when nothing is set?**

| Option | What happens |
|---|---|
| A. Keep it as the fallback after `X-Forwarded-For` | Nothing changes for an install that sets nothing. Behind any proxy that appends to `X-Forwarded-For` and leaves `X-Real-IP` alone, such as an AWS ALB, a caller chooses their own address (0.2, item 1) |
| B. Drop it in every mode | Closes that hole for installs that set nothing. Neither shipped target depends on it: Caddy always writes `X-Forwarded-For`, and the chart brings no proxy. A proxy that writes only `X-Real-IP` is named with `OPENOKR_CLIENT_ADDRESS_HEADER=x-real-ip` |
| C. Read it only when `X-Forwarded-For` is absent | The best of both, but Better Auth's list cannot express it, so Better Auth and `callerAddress()` would read differently, which is what D8 exists to stop |

**Recommended: B.** An unresolved caller shares a count, which is the safe direction; a caller who picks their own address escapes every count, which is not. It changes what a running instance does, so it carries a changeset and a line in the upgrade notes.

**Q2. Should the product carry Cloudflare's ranges itself?**

| Option | What happens |
|---|---|
| A. No. The operator supplies them; the guide shows the list with its date and where the current one is published | Nothing vendor-specific in shipped code. The operator's copy can go stale |
| B. A built-in name, `OPENOKR_TRUSTED_PROXIES=cloudflare`, compiled from the list at release time | Easier to get right on day one. The release's copy can go stale between releases, and every other CDN asks for its own name |

**Recommended: A.** If Q3 is answered as recommended, the Cloudflare setup does not use the ranges at all, so a built-in list would mostly serve the setup this design advises against. A stale list fails safe either way: a new edge's address is read as the caller, so visitors through it share a count rather than choosing one.

**Q3. Which Cloudflare setup should the guide lead with, and should OKRGoal move to it?**

| Option | What happens |
|---|---|
| A. Header mode, `CF-Connecting-IP`, with the ALB accepting only requests carrying a secret header your zone adds (or a tunnel, or client certificates of your own) | One address, written by Cloudflare. Cloudflare's headers reference recommends reading this header, and its origin-protection page describes all three locks. Needs one Transform Rule and one ALB listener rule on OKRGoal |
| B. Ranges mode with Cloudflare's list, with the same lock on the origin | Works, and needs the same lock to be safe (0.2, item 4). Whether a Worker's own `X-Forwarded-For` survives into your zone is not documented by Cloudflare, so it carries a doubt A does not |
| C. Ranges mode without locking the origin | What the plan row describes. It trusts hops that every Cloudflare customer's traffic can come from, on an origin anyone can reach (0.2, item 4) |

**Recommended: A, for the guide and for OKRGoal.** Until OKRGoal moves, its Cloudflare per-visitor rate limit stays.

## 7. What the specification gains, in the same change

- TECHNICAL-PLAN §4.14, the Instance row: `network.trustedProxies`, empty, from `OPENOKR_TRUSTED_PROXIES`, and `network.clientAddressHeader`, empty, from `OPENOKR_CLIENT_ADDRESS_HEADER`, both environment only, at most one of them set; this document named.
- TECHNICAL-PLAN §8.2: a **Caller address** row: one resolver for every per-address limit, the session row and the hold; the three modes; refused at boot when malformed; a change written to the instance chain.
- `docs/install/compose.md` and `docs/install/kubernetes.md`: a section "Behind a CDN or a load balancer" with section 2's table, the address check on `/account/security`, and the deployment check.
- `docs/install/cloud.md`, "Operating an instance": the Cloudflare plus load balancer setup Q3 chooses.
- `deploy/helm/values.yaml`, `deploy/helm/README.md`, `deploy/helm/templates/deployment.yaml`, `deploy/helm/templates/_validate.tpl`, `deploy/helm/check.sh`: D15.
- `deploy/docker/compose.yaml`, `deploy/docker/Caddyfile`, `deploy/docker/openokr`, `deploy/docker/smoke-test.sh`: D14.
- `.env.example`: both variables, commented, with one line each.
- `docs/admin/security.md`, "Per network": the count is per caller only when the instance can place callers, with a link to the install section.
- `docs/runbooks/observability.md`: `openokr_caller_addresses_total`.
- `docs/design/account-lockout.md` §0: the caller address row points here.
- UIUX-PLAN S-36: General gains the caller-address notice beside the tenant-floor notice, self-hosted only. The English and Malay message files.
- `packages/core/src/auth/caller-address.ts`: its header comment rewritten for the three modes.
- A changeset: behaviour changes with Q1 B even when nothing is set.
- `docs/runbooks/air-gap.md`: nothing. No list is fetched (D16), so no checklist row and no check is needed.
- REQUIREMENTS.md, METHOD.md, DATABASE.md and TECHNICAL-PLAN §7.2: nothing. No table, no rule and no import mapping changes.

## 8. What this does not do

- No hop count ("trust the last two hops"). Better Auth reads ranges only, and a second reader would break D8.
- No RFC 7239 `Forwarded` header and no PROXY protocol. The application never sees a socket.
- No screen to set either value, and no per-workspace value.
- No change to the limits' numbers or the hold's curve.
- No change to `X-Forwarded-Host` or `X-Forwarded-Proto`, which Caddy and the application already handle (`Caddyfile:45-60`).
- No check that the origin is locked to the CDN. The product cannot see it; the guide and the deployment check carry it.

## 9. As built

| Where | Differs from the design | Why |
|---|---|---|
| §7, the install guides | The topology table, the address check, the Cloudflare lock and the deployment check live on one page, `docs/install/behind-a-proxy.md`. `compose.md`, `kubernetes.md` and `cloud.md` each carry a short section that says what to set on that target and links to it | The notice on Admin, General (D12) links to one page, and one copy of the table cannot drift from another |
| D14, the Compose helper | `./openokr` copies the list before every compose call, not only `up` and `upgrade`, into `OPENOKR_CADDY_TRUSTED_PROXIES`, which `compose.yaml` hands the proxy as `OPENOKR_TRUSTED_PROXIES` with `127.0.0.1/32` as the default | `rotate-key` also runs `compose up`, and a recreate without the list would put Caddy back on loopback. A name of its own keeps a comma list exported in an operator's shell from reaching Caddy, which wants words |
| D7 | Any IPv4-mapped IPv6 entry is refused, a single address as well as a range | Better Auth reads both as IPv4, so the IPv4 spelling is the one that means what it says |
| D15 | The chart also refuses `network.trustedProxies` given as a string rather than a list | `--set network.trustedProxies=10.0.1.0/24` is the easy mistake, and a template ranging over a string fails with a message nobody can act on |
| D8 | `callerAddress()` takes an optional reading, for tests only. Everything in the product reads the environment's | The resolution rows of §1.1 are tested per mode without changing the process environment |
| D12, the boot order | The reading is announced and recorded after the tenant-floor check and before the relay starts | After the environment is validated, so a bad range has already refused the boot, and before anything is served |
| §5, the tests | In development and test Better Auth answers `127.0.0.1` for a caller it cannot place, so the unit tests read "unresolved" as what a request with no header gets, and the count of an unresolved caller is tested with Better Auth's reader stood in. The end-to-end server runs as production, so the real path is covered there | Better Auth fixes its environment when it loads |
| §5, the end-to-end run | The suite's server has no proxy in front, so every request without `X-Forwarded-For` is unresolved and the notice is up from the claim onward on every shard, not only after `s36-caller-address-notice.spec.ts` | That is what an instance with nothing in front of it and nothing set does. No spec reads the instance notices |

**OKRGoal's move to header mode (Q3) is an operations step.** In order: add a request header Transform Rule in the Cloudflare zone that sets a long random secret header on every request; add an ALB listener rule that forwards only requests carrying that header and make the default action a fixed 403; set `network.clientAddressHeader: cf-connecting-ip` and `helm upgrade`; run the deployment check in `docs/install/behind-a-proxy.md` against the ALB's own hostname; then remove the per-visitor rate limit at Cloudflare.

## 10. Combined with the hop count (11 November 2026)

While 0.8.0 was being built, the hardening batch on `main` added
`OPENOKR_TRUSTED_PROXY_HOPS` (`docs/design/sign-in-rate-limit.md`), another
answer to the same question. Merging `main` into the release had to pick one
rule, and Akmal decided to **combine** them:

| Rule | As merged |
|---|---|
| The default | The hop count, 1, not "one forwarded address only". It is right for both shipped installs without anything set |
| The ranges and the header | Kept, for a chain whose length varies and for a CDN's own header. Either replaces the hop count |
| At most one | Any two of the three set refuses the boot, naming the variable. The chart renders the hop count only when neither `network.trustedProxies` nor `network.clientAddressHeader` is set |
| Better Auth | Reads only the private header `withResolvedCaller` writes, the hardening batch's mechanism, for all three readings, so the limiter and `callerAddress()` cannot disagree |
| `X-Real-IP` (Q1) | Still never read with the ranges or a header. With the hop count it is read only with one proxy and no `X-Forwarded-For` at all, where that proxy overwrote the caller's value: the hardening batch's rule, and narrower than the case Q1 closed |
| The Admin, General notice and the metric (D12) | Unchanged: they count callers no reading could place |

