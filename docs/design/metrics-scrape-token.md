# A token for scraping the metrics endpoint

Status: proposed 9 November 2026 for release 0.7.0 (plan B3), waiting for "design approved". A new credential, so it is designed first (CLAUDE.md).

## 0. What exists

| Piece | Where | Today |
|---|---|---|
| The endpoint | `apps/web/app/api/metrics/route.ts` | Serves this process's series in Prometheus text format to a signed-in member with `full` access. Anything else gets not-found |
| The proxy | `apps/web/proxy.ts:288-296` | `/api/metrics` is not a public prefix, so a request with no session cookie is redirected to the sign-in page before the route runs |
| The Compose observability profile | `deploy/docker/compose.yaml`, `deploy/docker/observability/prometheus.yml` | Prometheus sends `Authorization: Bearer` with the contents of `secrets/observability-token`, and the comment tells the operator to make an API token at `/account/api-tokens` |
| API tokens | `/account/api-tokens` | Checked only on `/api/v1`. A member's token, scoped to a workspace |

So the profile cannot work. The proxy turns every scrape into a redirect, and if it did not, the route would ignore the token. `docs/runbooks/observability.md` says so today.

## 1. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **An instance scrape token, `OPENOKR_METRICS_TOKEN`**, not a member's API token | The series are the whole process's, not one workspace's, and a scraper is not a member. Tying it to a member means it stops working when that person leaves |
| D2 | Accepted **only** at `/api/metrics`, as `Authorization: Bearer <token>`, beside the session check that exists today. It grants nothing else | One credential, one door. Nothing else reads the variable |
| D3 | Compared in constant time: SHA-256 of both sides, then `timingSafeEqual` | Hashing first makes the two buffers the same length, so the comparison never returns early on a length difference |
| D4 | **Unset or empty means off.** No default value, ever. A token shorter than 32 characters is refused at boot with a message naming the variable | A default token is a published password. A short one is guessable over the network |
| D5 | `/api/metrics` joins the proxy's public prefixes. The route decides, and anything without a valid token or a `full` session still gets the same not-found | The route is where the decision already lives. Not-found rather than a redirect keeps the endpoint from saying whether it exists |
| D6 | **Compose:** `./openokr up` generates the token on first run and on any later `up` that finds it missing, writes it to `secrets/observability-token` (mode 600) and puts the same value in `app.env` | The profile then works with no manual step, and an instance installed before 0.7.0 gets one at its next `up` |
| D7 | **Helm:** a new key in the chart's generated Secret, kept across upgrades with `openokr.keepSecret` like the auth secret. `secrets.existingSecret` users add the key themselves; the chart README says which | The same rule as every other generated secret in the chart |
| D8 | Declared in the environment schema in `packages/config` as an optional secret, never logged, and listed in TECHNICAL-PLAN §4.14 as environment-only with an empty default | Every setting is declared with a default (CLAUDE.md) |
| D9 | A scrape is not audited. A refused token is counted in the existing refusal metric, with no label that carries the token | A read every 15 seconds would bury the audit trail. The count shows somebody guessing |
| D10 | Rotation: change the variable and the file, restart. Documented in the runbook | No rotation machinery for a read-only credential |

## 2. What an operator does

| Setup | Before 0.7.0 | After |
|---|---|---|
| Compose, observability profile | Make an API token, paste it into a file. Still did not work | `./openokr up`, then `docker compose --profile observability up -d` |
| Helm with the chart's Secret | Not possible | Point the cluster's Prometheus at the Secret key |
| Helm with `existingSecret` | Not possible | Add `OPENOKR_METRICS_TOKEN` to that Secret |
| A browser, by hand | Signed in with `full` access | Unchanged |

## 3. Acceptance criteria

- Given `OPENOKR_METRICS_TOKEN` set, when a request with no cookie sends `Authorization: Bearer <that token>` to `/api/metrics`, then it gets 200 with the Prometheus text.
- Given the token set, when the bearer is wrong or missing and there is no session, then the answer is 404, not a redirect.
- Given the token unset, when any bearer is sent, then the answer is 404.
- Given a member with `full` access signed in, when they open `/api/metrics`, then they get 200 as today.
- Given the token set, when the same bearer is sent to `/api/v1/goals`, then it is refused as an unknown API token.
- Given a token of 12 characters, when the server boots, then it refuses with a message naming `OPENOKR_METRICS_TOKEN`.
- Given a fresh Compose install, when `./openokr up` runs, then `secrets/observability-token` exists with mode 600 and the same value is in `app.env`.

## 4. Tests

| Kind | File | Covers |
|---|---|---|
| Unit | `apps/web/test/metrics-route.test.ts` | Token, wrong token, no token, session, token off |
| Unit | `apps/web/test/proxy.test.ts` (existing) | `/api/metrics` passes the proxy without a cookie |
| Unit | `packages/config/test/env.test.ts` (existing) | The length floor and the optional variable |
| Deployment | `deploy/docker/smoke-test.sh` | The token file exists and a scrape with it answers 200 |
| Deployment | `deploy/helm/check.sh` | The Secret carries the key and the pod reads it |

## 5. Documents changed in the same change

- `docs/runbooks/observability.md`: the profile works out of the box; how to rotate.
- `deploy/docker/observability/prometheus.yml`: the comment says where the token comes from.
- `docs/install/compose.md`, `deploy/helm/README.md`: the new secret.
- TECHNICAL-PLAN §4.14: the variable.
- `docs/runbooks/air-gap.md` needs nothing: the scrape stays on the Compose network.

## 6. What this does not do

- No per-workspace metrics and no metrics for a tenant. The series stay the process's own.
- No push, no remote write. The instance still sends nothing anywhere.
