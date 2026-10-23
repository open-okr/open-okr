---
"@openokr/web": patch
"@openokr/core": patch
---

A new workspace keeps the clock of the browser that made it, and a person
joining one keeps their own.

Every workspace used to start on UTC whatever the browser said, so rhythm
dates and quiet hours ran hours off for anybody elsewhere until somebody
changed it, and the setup question "Which clock does it keep?" said the zone
had been taken from the browser when it had not. The browser's zone now
reaches the server in a first-party cookie, `openokr_tz`, and is used when a
workspace is created, by sign-up, the setup wizard or single sign-on, and when
a member joins by a link, a trusted domain or a provider. A zone the server
does not list, a missing cookie or a page with no script all fall back as
before: UTC for a workspace, the workspace's zone for a member. Nothing
already created changes.

`invitations.acceptLink` and `invitations.joinByTrustedDomain` take an
optional `timezone`, refused when it is not a listed zone.
