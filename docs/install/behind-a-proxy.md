# Behind a CDN or a load balancer

Every limit OpenOKR keeps per network counts callers by their address: ten
sign-in attempts a minute, ten sign-ups a minute, the sign-in hold, the doors a
command-line login or an agent knocks on. The session list on
`/account/security` shows the same address.

The instance never sees the machine that connected to it. It reads the address
from a header the proxy in front of it writes. Which header, and which proxies
to look past, is something only you know about your network, so you tell it.
Get it wrong and every visitor is counted as one, and one person can use up the
sign-in limit for everybody.

## Check what it reads now

1. Sign in from a phone on mobile data, not on your office network.
2. Open `/account/security`. The session at the top shows the address this
   instance placed you at.

| What it shows | What it means |
|---|---|
| The phone's public address | Nothing to do |
| Your CDN's or load balancer's address | Every visitor shares that address. Set one of the variables below |
| Nothing | The instance could not place you. Set one of the variables below |

The instance says the same in three other places:

- **Admin, General** shows "This instance cannot tell some visitors apart" once
  it has met a request it could not place since it last started. Not on a
  managed cloud, whose operator reads the next two.
- **The log** has one line at boot: `caller address: one forwarded address
  only`, `caller address: X-Forwarded-For, trusting 22 ranges`, or `caller
  address: the cf-connecting-ip header only`.
- **The metric** `openokr_caller_addresses_total{outcome="unresolved"}`. A
  correct deployment never counts one.

## What to set

Three variables, environment only. Set at most one. Two set, or a malformed
entry, refuses the boot with the variable named.

| Variable | Helm value | What it does |
|---|---|---|
| `OPENOKR_TRUSTED_PROXY_HOPS` | `instance.trustedProxyHops` | **The default, 1.** How many proxies stand in front of the server: the visitor is the `X-Forwarded-For` entry that many places from the right, because each proxy appends what it saw and the rightmost entry is the one the nearest proxy wrote. Set 2 when a cloud load balancer sits in front of the ingress controller. `0` reads no header |
| `OPENOKR_TRUSTED_PROXIES` | `network.trustedProxies` | The proxies in front of the instance, as addresses or CIDR ranges, separated by commas, spaces or newlines. `X-Forwarded-For` is read from the right: a hop inside a range is skipped and the first address outside every range is the visitor. Entries a caller wrote sit on the left and are never reached |
| `OPENOKR_CLIENT_ADDRESS_HEADER` | `network.clientAddressHeader` | The one header your CDN writes the visitor's address into, such as `cf-connecting-ip`. Read alone, and only when it holds one address. **Safe only when the server refuses every request that did not come through your own CDN zone**, because anybody who reaches the server another way can write it |

With nothing set the hop count is 1, which is right for both shipped
installs: Caddy in Compose and one ingress controller in Helm. The ranges or
the header replace it for a chain whose length varies, or for a CDN that
writes the visitor's address into a header of its own. `X-Real-IP` is read only
with one proxy and no `X-Forwarded-For` at all, where that proxy overwrote
whatever the caller sent.

**Name your proxies' own addresses**, not a broad private range that also
holds people. A caller whose own address is inside a trusted range can choose
the address they are counted under. `0.0.0.0/0` and `::/0` trust everybody and
are refused. Host names are not read.

| Your setup | Set | Notes |
|---|---|---|
| Compose, Caddy on the internet | Nothing | Caddy writes one address |
| Compose, behind a load balancer you run | `OPENOKR_TRUSTED_PROXIES=10.0.1.0/24` in `secrets/app.env` | The load balancer's own addresses. `./openokr up` hands the same list to Caddy |
| Compose, behind Cloudflare | `OPENOKR_CLIENT_ADDRESS_HEADER=cf-connecting-ip`, with the server reachable only through your zone | Cloudflare Tunnel is the simplest lock on one server: it opens no port at all |
| Kubernetes, ingress controller behind a layer-4 load balancer that keeps the source address | Nothing, when the controller writes one address | Check the session address. If it shows the load balancer, use the next row |
| Kubernetes, ingress controller behind a layer-7 load balancer | `instance.trustedProxyHops: 2`, or `network.trustedProxies` with the load balancer's subnets when the chain's length varies | For the ranges, tell the controller to trust that load balancer and add to the header, below |
| AWS Application Load Balancer straight to pods | `network.trustedProxies` with the load balancer's subnets | Leave `routing.http.xff_client_port.enabled` off, its default: a port in the chain places nobody |
| Cloudflare, then a load balancer, then pods | `network.clientAddressHeader: cf-connecting-ip`, and a load balancer that refuses requests without a secret header your zone adds | Below |

**Ingress controllers.** Each has its own setting for which hops it believes,
and their defaults differ between versions, so check yours. In ingress-nginx
the ConfigMap keys are `use-forwarded-headers`, `compute-full-forwarded-for`
and `proxy-real-ip-cidr`. In Traefik it is the entry point's
`forwardedHeaders.trustedIPs`. The aim is the same everywhere: the controller
keeps the chain from the load balancer and adds the load balancer's own
address, and `network.trustedProxies` names the load balancer and the
controller's pods.

## Cloudflare in front of a load balancer

This is the setup to choose behind Cloudflare. Cloudflare writes the visitor's
address into `CF-Connecting-IP`, one address, so nothing has to be walked. The
work is making sure nobody reaches the load balancer without Cloudflare.

**Allowing Cloudflare's address ranges at the load balancer is not enough.**
Those ranges are shared by every Cloudflare customer, so any of them can send
traffic from there, including a header they wrote. Lock the origin to your own
zone instead, with one of these:

| Lock | How |
|---|---|
| A secret header | A request header Transform Rule in your zone adds a header, such as `X-Origin-Key: <a long random value>`, to every request. The load balancer forwards only requests carrying it and answers anything else with 403. On an AWS Application Load Balancer that is a listener rule matching the header, with the default action a fixed 403 response |
| Authenticated Origin Pulls | With a certificate of your own, not Cloudflare's shared one, which only proves the request came from somewhere in Cloudflare |
| Cloudflare Tunnel | The server opens no inbound port at all |

Then:

```yaml
# Helm
network:
  clientAddressHeader: cf-connecting-ip
```

```
# Compose: deploy/docker/secrets/app.env
OPENOKR_CLIENT_ADDRESS_HEADER=cf-connecting-ip
```

Restart, then run the deployment check below.

## Naming the ranges instead

Ranges mode works behind Cloudflare too, and needs the same lock on the origin.
This is Cloudflare's list as published at `https://www.cloudflare.com/ips/` on
10 November 2026. **Copy the current one when you deploy.** The instance never
fetches a list, so an air-gapped install works the same way and a list never
changes underneath a running instance. A stale list fails safe: visitors behind
a new edge share one count until you add it.

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

A load balancer that appends to the header, such as an AWS Application Load
Balancer, adds the edge it was reached from and never its own address, so
Cloudflare's list is enough behind one. When an ingress controller sits between
the load balancer and the pods and adds to the header too, add the load
balancer's subnets: the controller writes them in.

## The deployment check

Do this once the setting is in place, and again after any change to the
network in front. Send a sign-in to the load balancer's own hostname, past the
CDN, carrying addresses you made up:

```
curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST https://<the load balancer's own hostname>/api/auth/sign-in/email \
  -H 'Content-Type: application/json' \
  -H 'CF-Connecting-IP: 203.0.113.66' \
  -H 'X-Real-IP: 203.0.113.66' \
  -H 'X-Forwarded-For: 203.0.113.66' \
  -d '{"email":"check@example.com","password":"not-a-password"}'
```

| Mode | What must happen |
|---|---|
| Header mode | The load balancer refuses it, usually with 403. If it answers 401 from the instance, the origin is not locked and anybody can choose their address |
| Ranges mode | It may arrive. Repeat it eleven times: the 429 that follows writes `auth.rate_limited` to the instance audit chain, and that row's address must not be `203.0.113.66` |

## Changing it

Both variables are read at boot, so a change needs a restart: `./openokr up` on
Compose, `helm upgrade` on Kubernetes. The restart also clears the notice on
Admin, General. The first boot with a new reading writes one
`instance.caller_address_configured` row to the instance audit chain, so when
it changed is on record.
