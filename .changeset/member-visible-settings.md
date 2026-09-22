---
"openokr": patch
---

A member who did not create the workspace can open their own screens again.

`settings.readWorkspaceSettings` returns the whole stored settings map and is
declared full access, which is right for an admin card. Eight screens that are
not admin screens called it: the Overview and the welcome screen for one
onboarding flag, and the activity feed, a goal, the KPI list, a KPI, a person
and a space for the workspace timezone.

Provisioning gives every member edit on the workspace and reserves full for the
founder, so a colleague who was invited rather than one who signed up met an
error page on all eight.

`settings.readForMember` is the fix. It is declared view and returns a named
list of the two keys those screens need, rather than a filter over the stored
map: a filter would make the next setting somebody adds member-visible until
somebody noticed. The admin map is unchanged and still requires full access.

The goal screen had a second cause of the same kind. It read every AI
provider's configuration, including a masked key hint, to answer whether the
draft assist could offer anything. `ai.readAvailability` answers that with one
boolean and carries no provider, key, hint or status in it.

A self-hosted instance published on any port other than 80 can also sign in
now. The lifecycle helper wrote a bare `http://localhost` into the instance's
public address whatever port it was serving on, and authentication then refused
every browser sign-in because the origin a browser sends carries the port. The
smoke test drives the instance with curl, which sends no origin at all, so it
had always passed; it now checks the written address instead.
