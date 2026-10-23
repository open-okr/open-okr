# The browser's timezone, as the default

Status: approved 2026-10-15.

## 1. The gap

TECHNICAL-PLAN §4.14 sets two defaults from the browser:

| Setting | Specified default | What was built |
|---|---|---|
| Workspace `timezone` | The registering member's browser timezone, falling back to UTC | Always UTC |
| Member timezone | The browser timezone at first sign-in, falling back to the workspace timezone | Always the workspace's |

The receiving half existed: `ProvisioningContext.timezone` and the registry's
`resolveTimezone`. Nothing ever sent a value, so every workspace started on
UTC, and S-34's hint, "Taken from your browser when the workspace was
created", was untrue. Rhythm dates and quiet hours are read in the
workspace's timezone, so a workspace in Kuala Lumpur put every Monday
check-in eight hours early until somebody noticed.

Found by the 0.3.1 clean-install check.

## 2. How the zone travels

Only the browser knows it, and every path that creates a workspace or a
member arrives from a browser request. So the browser writes it into a
first-party cookie, and the server reads it where the row is made.

| Piece | What it is |
|---|---|
| `openokr_tz` | The cookie. The zone `Intl.DateTimeFormat().resolvedOptions().timeZone` reports, percent-encoded. `path=/`, a year, `SameSite=Lax`, `Secure` on https. Not `httpOnly`: script writes it |
| `BrowserTimezoneCookie` | A client component in the root layout. Writes the cookie after hydration when it is missing or different. Renders nothing |
| `matchListedTimezone` | In `packages/formats`, so the browser and the server share one copy (it was the picker's `matchDeviceTimezone`). A name on the server's list, or the listed name the runtime resolves it to (`Asia/Calcutta` to `Asia/Kolkata`), or null |
| `browserTimezoneFromCookies` | In `packages/core`. The cookie header to a listed zone or `undefined`. Never throws |

**Untrusted input, refused quietly.** A value that is not a listed zone
after matching is dropped, and the specified fallback applies. A bad cookie
must not stop a sign-up, which is why the readers return nothing rather than
an error. An API client passing `timezone` to a join action is different:
it asked for something specific, so a zone off the list is refused with a
sentence, as every other timezone write is.

## 3. Where it is read

| Path | Reader | Sets |
|---|---|---|
| Sign-up, the setup wizard, single sign-on | Better Auth's `user.create.after` hook, which already reads the invitation cookie the same way | The workspace and its owner |
| A first page with no workspace yet, and "make my own" on the trusted-domain page | `apps/web`, from `cookies()` | The workspace and its owner |
| An invitation or a provider during sign-up | The same hook, into `invitations.acceptLink` and the directory join | The joining member |
| `/join/<token>`, joining by trusted domain | The page's server action, into the action's optional `timezone` | The joining member |
| A member an importer left waiting, claimed at first sign-in | `provisionMemberForInvite`, which claims it | The member, only when it has no zone yet |

`resolveTimezone` matches to the list too. It took anything the runtime
resolves, so a browser's legacy alias would have been stored as a name the
settings card does not offer.

## 4. What it does not do

- **A member made without a browser** (an administrator adding a person,
  SCIM, an import) keeps no zone of its own and reads the workspace's, the
  specified fallback, until they set one. Their first sign-in through an
  invitation or a provider sets it; a plain password sign-in later does not,
  because nothing records that a sign-in is the first. Recorded rather than
  guessed at.
- **Nothing existing changes.** Workspaces and members already provisioned
  keep the zones they hold. No data change.
- **No JavaScript, no cookie.** Then the fallback applies, as before.

## 5. Acceptance

- Given a browser in `Asia/Kuala_Lumpur`, when somebody registers or finishes
  setup, then the workspace and its owner are on `Asia/Kuala_Lumpur`, and S-34
  shows it.
- Given no cookie, or one holding something that is not a zone, when a
  workspace is provisioned, then it is on UTC and sign-up succeeds.
- Given a browser reporting `Asia/Calcutta`, when the workspace is
  provisioned, then it is stored as the listed `Asia/Kolkata`.
- Given an invitation accepted from a browser in `Europe/Berlin`, then the new
  member's timezone is `Europe/Berlin` and the workspace's is unchanged.
- Given an imported member waiting with no zone, when its person claims it from
  a browser, then it takes the browser's zone; given one that has a zone, it
  keeps it.
- Given `invitations.acceptLink` called with `timezone: "Mars/Olympus"`, then
  it is refused and nothing is written.
