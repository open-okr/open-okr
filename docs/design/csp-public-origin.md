# Content Security Policy on HTTP and HTTPS

Status: **design approved on 19 November 2026**. Plan 0.9.1 A2. Akmal approved continued support for self-hosted HTTP in A2-Q on 19 November 2026.

## 1. What exists

| Fact | Where |
|---|---|
| Safari rendered a plain HTTP instance without styles, and sign-in did not work. The release checks traced this to `upgrade-insecure-requests`. | [0.9.0 known issues](../plans/release-0.9.0.md#71-known-issues-to-name-in-the-release-notes) |
| The proxy adds the directive outside development on both forwarded responses and sign-in redirects. It builds a fresh nonce and passes the same policy to Next.js and the browser on forwarded responses. | `apps/web/proxy.ts` |
| `BETTER_AUTH_URL` already names the public origin. Better Auth uses it for its base URL and uses its scheme to decide whether cookies are secure. The environment schema defaults to `http://localhost:3000`. | `packages/config/src/env.ts`, `apps/web/lib/auth.ts`, `packages/core/src/auth/auth.ts` |
| Compose writes the public origin when it creates the environment and reconciles the value on startup. Helm sets it from `publicUrl`, the ingress scheme or the internal service URL. A proxy can terminate TLS and forward HTTP to the app. | `deploy/docker/openokr`, `deploy/docker/Caddyfile`, `deploy/helm/templates/_helpers.tpl` |
| The trusted proxy settings resolve the caller's address. The address resolver has no independent view of the direct peer or of the browser's TLS connection. | [trusted-proxies.md](trusted-proxies.md) §§0 and 10 |

## 2. Decisions

| # | Decision | Reason |
|---|---|---|
| D1 | Use the scheme of the existing public origin from `loadEnv().BETTER_AUTH_URL` for the CSP decision. | The deployment already supplies the origin that authentication uses. This works when a TLS proxy talks to the app over HTTP and requires no new setting. |
| D2 | In development, omit `upgrade-insecure-requests`. Outside development, omit it for the resolved HTTP origin and include it for HTTPS. If the parsed origin uses an unsupported scheme, keep the directive outside development. | HTTP assets can load over the deployment's chosen transport. HTTPS keeps the current policy. The default origin continues to support a local HTTP install. |
| D3 | Resolve the decision from server configuration for every proxy response. `Host`, `Forwarded`, `X-Forwarded-Proto` and the request URL have no input into this decision. | Caller address trust is a separate policy. A request cannot change the deployment's CSP transport directive. |
| D4 | Apply the same decision to the response CSP, the CSP sent upstream to Next.js, and sign-in redirects. Keep the other directives, nonce forwarding, route matching and redirect logic as they are. | The header Next.js reads and the one the browser enforces must agree. This fixes one directive and preserves the existing security controls. |
| D5 | Preserve HSTS, cookie options, passkey origin and origin validation. Document that `BETTER_AUTH_URL` should match the browser-facing origin, including the scheme and any nondefault port, when a deployment uses its own reverse proxy. | The same public origin already governs authentication. A deployment installs with its current configuration and picks up the fix on upgrade. |

## 3. Test cases

| Given | When | Then |
|---|---|---|
| A production instance with a public HTTP origin | Safari visits `/sign-in` and signs in | The page and redirect policies omit the upgrade directive. The scripts and styles load from the HTTP origin, and sign-in reaches the workspace. |
| A production instance with a public HTTPS origin and TLS terminated at the reverse proxy | Safari signs in through the proxy | The app includes the directive even when its upstream request is HTTP. The assets and sign-in work over the public HTTPS origin. |
| An HTTP or HTTPS deployment | A request supplies a forwarded scheme that differs from the configured origin | The directive follows the configured origin. Test both a forwarded page and a sign-in redirect. |
| The public origin is unset | A production instance uses the existing default URL | The HTTP default omits the directive. |
| A development instance with a configured HTTPS origin | A page renders | The development policy omits the directive and keeps its existing script and style allowances. |
| Either production transport | A forwarded page renders | The request and response CSP agree, the nonce is fresh, and the rest of the policy and security headers retain their values. |

| Verification | Where |
|---|---|
| Header coverage | Extend `apps/web/test/proxy.test.ts` for the two schemes, the default, conflicting forwarded headers and both response paths. Restore the environment and the config cache between cases. |
| Browser coverage | Check a production build in Safari on a disposable HTTP origin and an HTTPS origin behind a TLS proxy. Use a local hostname or address for HTTP so the test covers the reported deployment shape. Check styling, asset requests and sign-in, and record which browser version was used. |
| Upgrade notes | Add the public origin rule to the 0.9.0 to 0.9.1 notes in `docs/runbooks/upgrade.md`. Run `pnpm check:docs`. |
