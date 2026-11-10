# The version footer and the update check

The footer of the content area shows the running version to every signed-in member,
and an administrator the newest GitHub release when the instance is behind it. Requested by the product
owner on 2 November 2026. Authority: REQUIREMENTS.md §7 (air-gapped
operation), TECHNICAL-PLAN.md §4.14 (instance settings), UIUX-PLAN.md §3.

## 0. What already exists

| Component | Where | What it gives this change |
|---|---|---|
| The running version | `apps/web/package.json` `version` (0.5.0 today) | The number to show. The release pull request bumps it, and `check:docs` already pins pages to it |
| A version is kept behind a session | `apps/web/app/api/app-version/route.ts` | The stance: a version string is reconnaissance, so it is never shown signed out |
| The content pane | `apps/web/lib/app-shell.tsx`, inside `main` | Where the line goes: at the foot of every signed-in screen, on the right. Moved there from the sidebar footer at the product owner's request on 2 November 2026, so the sidebar holds navigation only |
| `outboundFetch` | `packages/adapters/src/outbound/guard.ts` | The only way out: timeout, size cap, no redirects, address checks |
| Instance settings with an environment bootstrap | `packages/core/src/secrets/instance-registry.ts` | The switch, `instance.updateCheck` |
| GitHub's public release API | `https://api.github.com/repos/open-okr/open-okr/releases/latest` | The newest release, pre-releases skipped, no token. 60 requests an hour per address |

## 1. Decisions

| Question | Decision | By |
|---|---|---|
| On by default | Yes. An administrator turns it off in Admin, General, or the operator with `OPENOKR_UPDATE_CHECK=off` | Product owner, 2 Nov 2026 |
| Who sees the version | Every signed-in member. Signed-out pages show none, because there it would tell anybody scanning for instances behind a known fault which ones are. Until 0.8.0 only members holding `full` saw it, which hid it on every OKRGoal instance from the people reporting a problem | Akmal, 10 Nov 2026 (plan 0.8.0 V1, Q7), replacing the owner's decision of 2 Nov 2026 |
| Who sees the notice | Members holding `full` on the workspace (the admin screens' own gate), because only they can act on it | Product owner, 2 Nov 2026 |
| Managed cloud | The running version only. No check and no notice: the operator upgrades, not the customer | Product owner, 2 Nov 2026 |
| Source | GitHub Releases, `releases/latest` | Product owner, 2 Nov 2026 |
| Is it telemetry | No. The request carries no instance data: no version, no name, no identifier, and the `User-Agent` is the fixed `OpenOKR-update-check`. GitHub sees only the server's address. REQUIREMENTS §7 makes telemetry opt-in; this is recorded here as the reading taken | This design. **Risk:** a reader of §7 may take any default outbound call as telemetry |

## 2. The check

| Rule | Value |
|---|---|
| Where it runs | The server, in `apps/web/lib/update-check.ts`, through `outboundFetch` from `packages/adapters` |
| How often | At most once per 24 hours per process, cached in memory. A failure is cached for 1 hour, so an air-gapped instance with the switch left on tries once an hour and no more |
| Never blocks a page | The footer reads the cache. A stale or empty cache starts one refresh in the background and the page renders without the notice |
| Timeout and size | 3 seconds, 64 KB |
| Parsing | `tag_name` (`v0.5.0`) and `html_url`, validated with Zod. Anything else is a failure |
| Comparison | Semantic version, major, minor, patch. Behind only when the release is strictly newer. A running pre-release (`0.5.0-rc.1`) counts as its base number, so `0.5.0-rc.1` is not behind `0.4.0` |
| Off | The switch is read per request. Off means no request, and the notice is gone |

## 3. The footer

| State | Shown, for a member with `full` | Shown, for any other member |
|---|---|---|
| Up to date, or not known | `v0.4.0` | `v0.4.0` |
| Behind | `v0.4.0` and, beside it, a brand chip "v0.5.0 available" linking to the release's `html_url` | `v0.4.0` |
| Check off | `v0.4.0` | `v0.4.0` |
| Managed cloud | `v0.4.0` | `v0.4.0` |

Small text (`text-xs text-ink-3`, the band's), right-aligned, at the foot of the content
area: after the screen's content, and at the bottom of the pane when the
content is shorter than it. The same at every width, because the content pane
has room the icon-only sidebar did not. A member without `full` sees the version and never the notice, and nothing is asked of GitHub on their behalf.

## 4. The switch

`instance.updateCheck`, boolean, fallback `true`, environment
`OPENOKR_UPDATE_CHECK`. Added to TECHNICAL-PLAN §4.14 and to the air-gap
runbook's connection table ("Update check: one request a day to
api.github.com; turn it off with `OPENOKR_UPDATE_CHECK=off` or in Admin,
General"). Admin, General gets an "Update check" card with one checkbox,
absent on a managed cloud like the instance name card, saved through the same
instance-settings writer with an instance audit event.

## 5. Acceptance criteria

**Given** an administrator on a self-hosted instance running 0.4.0 and a
release v0.5.0, **when** any signed-in screen renders after the cache is warm,
**then** the footer shows `v0.4.0` and a link "v0.5.0 available" to the
release page.

**Given** the same instance on v0.5.0, **then** only `v0.5.0` shows.

**Given** a member without `full`, **then** the footer shows the running version
and no notice, whatever release exists (plan 0.8.0 V1).

**Given** a signed-out page, **then** no version is shown.

**Given** the check is off, **then** no request leaves the instance and only
the running version shows.

**Given** GitHub does not answer, **then** the page renders at its usual speed
with the running version only, and the next attempt waits an hour.

**Given** a managed cloud, **then** no request is made and only the running
version shows.

## 6. Tests

| Test | Kind |
|---|---|
| Version comparison, pre-release handling, tag parsing, bad payloads | Unit, `apps/web/test/update-check.test.ts` |
| Cache: one request per day, one per hour after a failure, none when off or on a cloud; never awaited by the render | Unit, same file, with a fake fetch and a fake clock |
| The setting resolves to on with nothing configured, and to off from the environment | Unit, `packages/core` instance-registry tests |
| The version for every member, the notice for an administrator only | Unit, `apps/web/test/version-footer.test.ts` |
| The footer for an administrator | End to end, `e2e/s36q-version-footer.spec.ts` (the check off, so CI makes no outbound call) |
| `check:air-gap`: the new connection row is listed | The existing gate |

## 7. What this change does not do

- No upgrade button. Upgrading stays `deploy/docker/openokr upgrade` or Helm.
- No release notes on screen. The link opens GitHub.
- No email or nudge about a new version.
- No check of the container registry.

## 8. The band (revamp, 2 November 2026)

The owner asked for the footer to be separated from the content by a rule and a different background, compared three prototypes (a `raised` band, a white band, a rule only) and chose the white band.

| Part | Rule |
|---|---|
| Band | A hairline (`line`) over a `surface` band, the width of the content pane: it takes `main`'s padding back as negative margins |
| Left, everyone | The instance's name, when somebody has named it. The "Built on OpenOKR, open source" link moved on 4 November 2026, at the owner's request, to the avatar menu as "Source code", still shown to every member because AGPL-3.0 §13 offers the source to every network user |
| Right, everyone | ⌘K Search, and ⌘J Ask only while the copilot can answer (an AI affordance is hidden when the provider is off). Hidden on a phone, which has no ⌘ key |
| Right, everyone | The running version (plan 0.8.0 V1) |
| Right, full access | The newer release as a brand chip, as §3 |
| Position | Sticky to the foot of the content pane, always in view while the page scrolls under it (the owner asked for it to stay put). On a phone it sits on the fixed tab bar |
| Phone | Two lines, left aligned, above the tab bar |

The footer is therefore shown to every member; only the notice is gated as §3 says. `apps/web/lib/app-footer.tsx` draws the band, `version-footer.tsx` the version and the notice, and `newest-release.ts` holds the one checker per process.

