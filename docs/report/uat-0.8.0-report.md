# OpenOKR 0.8.0 acceptance test

## Run details

| Item | Value |
|---|---|
| Commit tested | `95c5e81339e0a350a5f5602f3622b6f24ee7040f` (`origin/release-0.8.0`, 2026-11-11 09:44 +0800). Four commits newer than `87e32ade`, the build log's last recorded state |
| Later commits | `b3ed6a98` (CodeQL fixes in the IPv6 range parser and a constant rename in `password-change.ts`) landed after the run. It touches no finding below; the audit action is still `auth.password_changed` |
| Run | 2026-11-11, 08:59 to 09:39 WIB |
| Method | `deploy/staging/deploy-staging.sh` (Docker), Compose project `openokr-uat`, HTTP on port 8088. Not the `pnpm dev` fallback |
| Mail | SMTP to the local MailHog (`host.docker.internal:1025`), read at http://localhost:8025. No mail left the machine |
| Outbound | GitHub release check left on, as agreed. A fake Anthropic key was set in round C; no copilot question was sent, so no request to the provider was made by me |
| Browser | Playwright MCP (Chromium), 1440x900 and 390x844, plus touch emulation for the phone tour |
| People | Founder `qa+founder@example.com` (Owner); seven seeded personas; Daniel set to Admin; Mei and an invited `qa+vera@example.com` set to Viewer; Jonas granted cloud operator in round C |
| Screenshots | `/Users/bedd/Obed/Work/FLOWYTEAM/uat-0.8.0/screenshots/` (file names below are in that folder) |

Rounds, because some settings need a restart or a fresh database:

| Round | Instance | Rows |
|---|---|---|
| A | Self-hosted, mail on | S1 to S4, Y1 to Y6, F1, L1, L2, R1, T1, V1, H13, O1 (no provider), registration refusal |
| B | A plus `OPENOKR_DEMO=on` | D1, T1's demo rule |
| C | A plus `OPENOKR_CLOUD=true`, a catalogue (Free with 0 credits, Team with 2,000), a fake provider key, then `OPENOKR_CLOUD_DEFAULT_PLAN=team` | V2, O2, O1 (plan reason), S4 on a cloud |
| D | Destroyed and rebuilt with `OPENOKR_REGISTRATION=invite_only` | H3 |

## Fix status

Fixed on `release-0.8.0` on 11 November 2026, one commit per finding, each with a changeset, and checked again in a browser on an image rebuilt from `b803f7e7`.

| Finding | Commit | Checked in the browser |
|---|---|---|
| F-01 Uploads above 10 MB | `700c2584` | A 24 MB file attaches |
| F-02 Tour card off screen on a phone | `4cbaf8ed` | All three phone steps show the card above the lit tab, finished by tapping |
| F-03 Admin has no way to the cycle page | `edd81ba9` | An Admin sees Cycle and the phase strip; a Member still does not |
| F-04 Viewer role cannot lower an invited member's Edit | Open | Left for Akmal (Q-1). `cycles.setupAccess` records the Edit binding as deliberate ("every member holds `edit` for self-service"), which points at L2's `canEdit` reading the workspace level |
| F-05 "No plan" shown as "Free" | `ae15cbde` | S-46, the console filter and the Plan page say "No plan" with a catalogue |
| F-06 Facilitator item focuses the Sponsor picker | `33951929` | Each item focuses its own picker |
| F-07 Focus lost after Take the tour again | `081468d9` | Escape returns focus to the account menu button |
| F-08 Malay gaps | `b803f7e7` | Sidebar, bottom bar, menu rows and the role ("Ahli") in Malay. Wording not reviewed by a native speaker |
| F-09 "not configured" chip beside the plan reason | `9dbcaf59` | The chip is gone while the plan sentence shows |
| F-10 Focus after sign-up | `e914fbdf` | Focus is on the card's heading; Tab reaches Send the link again |
| F-11 4 px overflow at phone width | `2de81a71` | Nothing past 390 px on `/cycle` or `/account` |

## Findings

Ranked by severity.

### F-01. Uploads between 10 MB and 25 MB fail and crash the cycle page

- **Row:** H13
- **Severity:** blocks the release
- **Steps:** as the Owner, open `/cycle`. In the Files card, choose `upload-24mb.pdf` (25,165,824 bytes) and press Attach. Repeat with 11 MB and 9 MB files.
- **Expected:** the 24 MB file attaches; the card says "Up to 25 MB a file".
- **Actual:** the server answers 500 and the page is replaced by "We could not load this cycle. This is our fault, not something you did." The 11 MB file fails the same way. The 9 MB file attaches. The 26 MB file is refused in the browser before sending, correctly ("That file is 26 MB. A file can be up to 25 MB."). The app log says: `Request body exceeded 10MB for /cycle. Only the first 10MB will be available unless configured. See .../middlewareClientMaxBodySize`, then `Error: Unexpected end of form` (digest 2192929614). The server-action limit was raised to 27 MB, but the proxy's own 10 MB body cap was not, so the real limit in the Docker image is 10 MB and anything above it ends on an error page.
- **Screenshots:** `H13-02-24mb-result.png`, `H13-03-upload-11mb.png`, `H13-04-files-card-after-9mb.png`, `H13-01-26mb-refused.png`

### F-02. On a phone the product tour card is off screen, and the person is stuck

- **Row:** T1
- **Severity:** blocks the release
- **Steps:** at 390x844 with touch emulation, sign in for the first time as Sara. Tap Start tour. Also: as Priya, Account menu, Take the tour again.
- **Expected:** each step's card sits beside the lit area with Back, Next and Skip tour.
- **Actual:** on all three phone steps (Home, Updates, Goals: the tabs in the bottom bar) the card is placed below the bottom bar, at top 860 px on an 844 px screen, so it is never visible. The screen is dimmed and taps do nothing. A phone has no Escape key, so the only way out is reloading the page, which offers the welcome dialog again. The same happens in Malay.
- **Screenshots:** `T1-08-phone-sara-step1-touch.png`, `T1-06-phone-en-step1.png` to `T1-06-phone-en-step3.png`, `PHONE-tour-step1.png` to `PHONE-tour-step3.png`

### F-03. An Admin can set up a cycle but has no way to reach the cycle page

- **Row:** R1
- **Severity:** should fix before release
- **Steps:** give Daniel the Admin role. Sign in as Daniel.
- **Expected:** R1 lets an Admin create a cycle and name its sponsor, so an Admin can find where to do it.
- **Actual:** Daniel's sidebar has Home, Updates, Goals, Work and Spaces, with no Cycle. His home has no cycle strip, and his tour has no cycle-strip step (4 steps, not 5). The Goals section tabs offer only Map. `apps/web/lib/app-shell.tsx` shows Cycle and the strip only to readers who hold admin navigation (Full on the workspace) or a coordinator or manager role in a space, and an Admin holds Edit. Typing `/cycle` works, and everything R1 promises works there: Create is offered, Archive is not, and Daniel created Q1 2027 and named Priya sponsor and Sara facilitator on Q4 2026.
- **Screenshots:** `R1-04-admin-home-no-cycle-nav.png`, `R1-03-admin-created-cycle.png`, `R1-02-admin-cycles-card.png`

### F-04. A Viewer-role member is shown "Start drafting" and can draft, and the menu calls them Viewer

- **Rows:** L2, Y1
- **Severity:** should fix before release (or decide it is correct, see question Q-1)
- **Steps:** as the Owner, invite `qa+vera@example.com` from Admin, Invitations; accept and confirm through MailHog; set Vera to Viewer on Admin, Roles. As Vera, open the Work Map for the empty Q1 2027 cycle, then Phase 4.
- **Expected:** L2: a reader who cannot edit goals gets the sentence alone. Y1: the role name tells the person what to expect.
- **Actual:** Vera sees the Start drafting button and, on Phase 4, Add objective. Her avatar menu says "Viewer". A read of the database shows every invited member (Vera included, and all seven seeded personas) holds a level 70 (Edit) binding on the workspace context, and a role never lowers access. So no invited member can be below Edit, L2's viewer branch cannot be reached, and Y1's "Viewer" label promises less access than the person has.
- **Screenshots:** `L2-vera-true-viewer.png`, `L2-mei-viewer-phase4.png`, `L2-daniel-admin.png`

### F-05. "No plan" is shown as "Free", which is also the name of a real plan

- **Row:** O2 (and O1's "Choose a plan" link)
- **Severity:** should fix before release
- **Steps:** round C, before any default plan. Open the operator console, a workspace's page (S-46), and as the Owner, Admin, Plan and seats.
- **Expected:** a workspace with no plan reads as having no plan, so the operator and the customer can see what O2 is about.
- **Actual:** S-46's Tenant card says "Plan: free" and, on the next line, "This workspace has no plan". The customer's Plan page says "Current plan: Free". The console's plan filter offers both "Free (no plan)" and "Free". With a catalogue that has a plan named Free, as OKRGoal's does, the two cannot be told apart. The Plan page also says "To change this plan, contact Northwind UAT." with no address or link.
- **Screenshots:** `O2-02-s46-no-plan.png`, `O1-05-choose-a-plan.png`, `O2-01-operator-console.png`

### F-06. "No facilitator named" focuses the Sponsor picker

- **Row:** F1
- **Severity:** should fix before release
- **Steps:** as the Owner on Phase 1, click "No facilitator named" under Still needed here.
- **Expected:** the Facilitator picker gets focus.
- **Actual:** both items link to `#need-roles` and focus the Sponsor picker. The other eight items each focus their own row or button.
- **Screenshots:** `F1-03-facilitator-focus.png`, `F1-01-sponsor-focus.png`

### F-07. Focus is lost when the tour ends from "Take the tour again"

- **Row:** T1
- **Severity:** should fix before release
- **Steps:** as Daniel, Account menu, Take the tour again, then Escape.
- **Expected:** "hold focus and give it back where it was", so back on the Account menu button.
- **Actual:** focus goes to the page body. The same happens after Escape on the first welcome dialog (where there was no earlier focus).
- **Screenshots:** `Y1-02-admin-menu.png` (start point)

### F-08. Malay: the account rows of the avatar menu stay in English

- **Rows:** Y1, Y2
- **Severity:** can wait
- **Steps:** as Priya, Your account, Language, Bahasa Melayu. Open the avatar menu.
- **Expected:** the menu in Malay.
- **Actual:** "Your account", "Where to reach you", "Security", "API tokens", "Connected apps", "Your AI keys" and the role "Member" are English. The other entries, the Your account page, Security and the tour are Malay. The bottom tab bar on a phone also shows Home, Updates, Goals and Work in English beside "Lagi".
- **Screenshots:** `I18N-02-menu-ms.png`, `PHONE-tour-step1.png`

### F-09. The "not configured" chip stays on Admin, AI beside the plan reason

- **Row:** O1
- **Severity:** can wait
- **Steps:** round C, workspace with no plan. As the Owner open Admin, AI.
- **Expected:** O1 named "the AI settings page shows Not configured" as part of the wrong reason.
- **Actual:** the new sentence is right ("This workspace's plan includes no AI credits ... Choose a plan"), but the "not configured" chip is still at its side.
- **Screenshots:** `O1-04-admin-ai-plan-reason.png`

### F-10. The check-your-email card takes focus away and announces nothing

- **Row:** S1
- **Severity:** can wait
- **Steps:** sign up as a stranger with confirmation on Automatic.
- **Expected:** a keyboard or screen reader user learns the form became the card.
- **Actual:** the active element becomes the page body; no live region carries the card's text. The next Tab reaches "Send the link again", so the keyboard path still works.
- **Screenshots:** `S1-01-check-your-email.png`

### F-11. A 4 px overflow on the cycle page and Your account at phone width

- **Rows:** L1, Y2
- **Severity:** can wait
- **Steps:** 390 px, `/cycle` and `/account`.
- **Actual:** the file input and its label end at 394 px. The page itself does not scroll sideways.
- **Screenshots:** `L1-02-cycle-phone-full.png`, `PHONE-account.png`

## Row results

| Row | Result | Notes |
|---|---|---|
| S1 Check your email | Passed | Card after sign-up, address not in the URL, 24 hours stated, spam hint, Back to sign in. F-10 |
| S2 Confirmed page, expired and broken link | Passed | Confirmed page; an older link opened after a newer one also lands there. Broken link: "This link is not valid". Expired link: tested with a token signed with the instance secret and an `exp` in the past, since waiting 24 hours was not possible; Better Auth answered `TOKEN_EXPIRED` and the page said "This link has expired" with the resend form |
| S3 Send the link again, and its limits | Passed | Works on the card, the expired page and sign-in. 1 a minute per address (429 `VERIFICATION_RESEND_HELD`, seconds given), 5 a day per address ("Try again in 24 hours"), 5 a minute per network. Unknown and confirmed addresses get the same 200 after the 500 ms floor |
| S4 Confirmation Off | Passed | Welcome card with Get started and nothing about confirming; Get started goes straight to onboarding; the optional mail says "You can use your account now". Company domains greys out Off with the reason. Audited (`instance.email_verification_set`). On a cloud the card leaves Admin, General and appears on the operator's Instance screen |
| H3 Invite-only instance can be claimed | Passed | Fresh instance with `OPENOKR_REGISTRATION=invite_only`: the wizard created the first account; the next sign-up page and the API both say "This instance is invitation-only. Ask a workspace admin to invite you." |
| Sign-up refused by policy says why | Passed | Same sentence on the closed sign-up page and from the API (422) |
| Y1 Avatar menu says who you are | Passed, with findings | Name, email and role for Owner, Admin, Member and Viewer; header links to `/account`. F-04, F-08. The Demo account and Support access chips could not be tested (no `demo:prepare` account, no support session) |
| Y2 Your account page | Passed | Every card present except Delete your account, which is Y7 and not built on this commit |
| Y3 Change password | Passed | Wrong current password refused; mismatch refused; success with "Sign out my other devices" ended the other session and kept this one; mail sent; `auth.password_changed` audited; the sixth wrong password from one session got 429 `SIGN_IN_HELD`, and so did a sign-in |
| Y4 Change sign-in email | Passed | Neutral answer for an address Sara holds (Sara got "This address already has an account"; Amara's old address got the notice). Free address: link to the new address, notice to the old; signed out, the link asks to sign in first; signed in, "Your sign-in email is now ..."; new address signs in, old one does not; audited |
| Y5 Change your name | Passed | Saved, seen in the menu and in Daniel's people list; an empty name is refused |
| Y6 Switched-off auth endpoints | Passed | `/update-user`, `/update-session`, `/delete-user`, `/list-accounts`, `/ok`, `/refresh-token`, `/passkey/update-passkey`, `/list-sessions` answer 404 with a session; the name was not changed. Sign-in, sign-out, forgot password and reset, the Security page and its session list all work |
| F1 Still needed here leads to the field | Failed | F-06. The other eight items focus their field. A Member sees "An Owner or an Admin fills this in." with no link, as designed |
| L1 Roles above the timeline | Passed | Stacked at 1440 and 390; sponsor and facilitator side by side inside Roles; When wraps. F-11 |
| L2 Start drafting is a button | Partly passed | Primary button to `/cycle?phase=4` for editors. The viewer case could not be shown (F-04) |
| R1 Admin sets up a cycle | Passed, with finding | Admin created a cycle and named sponsor and facilitator; Member refused (403 on create and update through REST); Admin refused archive (403); Owner keeps Archive. F-03 |
| T1 Product tour | Failed | Desktop: start, skip with Escape and finish with the keyboard only all work; focus stays in the card; the count is announced; nothing behind is clickable; Take the tour again works; Ask AI and the cycle strip are left out when not on screen; on a demo the choice is per browser. Phone: F-02. Also F-07 |
| V1 Version for every member | Passed | `v0.7.0` in every member's footer, none on signed-out pages. The "available" link for administrators could not be tested: no newer release exists. See Q-2 |
| V2 Operator's Version card | Passed | S-47 shows "This instance runs v0.7.0. No newer release is known." The newer-release chip could not be tested for the same reason |
| O2 Workspaces with no plan | Passed, with finding | Console notice and per-row "No AI on the provider's key"; S-46 fact; review page lists seats; "Put 3 workspaces on Team" moved all three and wrote `operator.default_plan_filled`. F-05, Q-6 |
| D1 Demo pill | Passed | On the sign-in card and in the top bar at 1440 and 390, focusable, tooltip and hidden text with the sentence |
| O1 Copilot says why AI is off | Passed, with finding | No provider: "No AI provider is configured ...". Plan without credits: "This workspace's plan includes no AI credits ..." on the copilot and Admin, AI. On Team the chip goes. F-09 |
| H13 Upload limit | Failed | F-01 |
| English and Malay | Partly passed | F-08. Still-needed items stay English, which the plan lists as out of scope |
| Keyboard focus | Partly passed | Visible on every control tried. F-07, F-10 |
| Phone width | Failed | F-02 is the only blocker; F-11 is cosmetic |
| Loading, empty and error states | Passed | Empty Work Map, empty pack, "never measured" usage and the error card (seen in F-01) read as intended |

Rows in the plan but not in this brief, and not tested: C1, H2, H5 to H12, H14, O3, Y7.

## Questions

Things I am not sure are bugs.

- **Q-1.** Should an invited member get an Edit binding on the workspace at all, given that a Viewer role cannot lower it? This decides whether F-04 is a bug in L2 and Y1 or in the invitation default.
- **Q-2.** The release under test reports `v0.7.0` everywhere (footer, S-47, Admin, General). I assume the version is bumped when the changesets are released. Confirm.
- **Q-3.** The join page tells an invited person "Create an account with that address and you will land straight in the workspace", but sign-up then asks them to confirm their email and sign in. S5 (designed, approved, not built on this commit) covers this. Should S5 be in 0.8.0?
- **Q-4.** A Member can mark input pack items as gathered and press Confirm distribution. Intended?
- **Q-5.** On the last tour step, ArrowRight acts as "Start drafting OKRs" and leaves the page. Intended?
- **Q-6.** The bulk default-plan action ran with the Reason field empty and recorded "Put on the default plan from the console". Should a reason be required, as for a single plan change?
- **Q-7.** Notice mails (password changed, email change asked) give the time in UTC, not in the person's timezone.
- **Q-8.** Signed-out pages follow the instance language, not the browser's. A Malay browser sees English sign-in and confirmation pages.
- **Q-9.** Turning the cloud flag on after workspaces exist shows "0 tenants" until the hourly adopt runs or `pnpm cloud:adopt` is run. Documented, but an operator following the O2 story would meet it.
- **Q-10.** Not new in 0.8.0, seen while testing: "Sign out" in the avatar menu is a plain button inside the menu, so arrow keys skip it; the footer band is sticky on a phone and takes 63 px; the "Connect your AI agent" pill is cut off on both sides at 390 px; the role matrix truncates "Manage" to "Man"; `./openokr up` always ends with "Open ... to finish setup", also on a set-up instance.
- **Q-11.** Local only: this checkout had an untracked symlink `apps/web/.env -> ../../.env`. `.dockerignore` excludes only the root `.env`, so the symlink went into the build context and `next build` stopped on it. A nested `.env` holding real values would be copied into the build stage. I moved it aside for the run.
