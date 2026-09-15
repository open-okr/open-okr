---
"openokr": patch
---

Every screen tells you it is loading, including the ones that were not part
of the application yet.

Signing in, the first-run wizard, onboarding and following an invitation all
left the page you came from on screen while the next one was fetched, with
nothing moving to say anything was happening. Those screens draw their own
card rather than sitting inside the sidebar and the topbar, and the rule that
decided which screens got a loading state was tied to where an error would
draw instead of to whether you were waiting. The two are separate questions
and are now answered separately.

The skeleton matches the screen it stands in for: a centred card where the
screen is a centred card, a panel where the screen is a panel. A full-width
placeholder resolving into a small centred form is a bigger jump than no
placeholder at all.

**Plan and seats and Support access have icons in the admin list.** They were
the only two sections without one, so they read as two labels in a column of
illustrated rows.
