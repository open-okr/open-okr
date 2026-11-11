---
"@openokr/config": patch
"@openokr/core": patch
"@openokr/web": patch
---

Sign-in limits count each caller by the right address behind a proxy that appends to `X-Forwarded-For`. The new `OPENOKR_TRUSTED_PROXY_HOPS` (Helm `instance.trustedProxyHops`, default 1) says how many proxies stand in front of the server. Put 2 when a cloud load balancer sits in front of the ingress controller.
