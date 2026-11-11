# @openokr/config

## 0.8.0

### Patch Changes

- [#204](https://github.com/open-okr/open-okr/pull/204) [`cdad1fa`](https://github.com/open-okr/open-okr/commit/cdad1fa90e1f045a5907520c99f47de49f2748c9) Thanks [@agungksidik](https://github.com/agungksidik)! - Sign-in limits count each caller by the right address behind a proxy that appends to `X-Forwarded-For`. The new `OPENOKR_TRUSTED_PROXY_HOPS` (Helm `instance.trustedProxyHops`, default 1) says how many proxies stand in front of the server. Put 2 when a cloud load balancer sits in front of the ingress controller.

## 0.7.0

No changes in this release.

## 0.6.0

No changes in this release.

## 0.5.0

No changes in this release.

## 0.4.0

No changes in this release.

## 0.3.1

No changes in this release.

## 0.3.0

No changes in this release.

## 0.2.0

No changes in this release.

## 0.1.2

No changes in this release.

## 0.1.1

No changes in this release.

## 0.1.0

No changes in this release.
