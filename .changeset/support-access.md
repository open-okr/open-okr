---
"openokr": minor
---

Support access, and the promise that comes with it: nobody from outside gets
into a workspace unless somebody inside it says yes.

An operator asks, giving a reason. A member who can manage access reads the
reason and decides, choosing how long and how much. There is no path in this
release that lets an operator into a workspace on their own, and that is the
product promise rather than a setting.

**A granted session is a real guest membership**, created through the same
funnel every other joining path uses. From that moment the operator is
answered by the same permission checks as anybody else: a space they were not
given reads as not-found, a write above their granted level is refused, and a
suspended workspace refuses them too. Nothing about support access is a
special case in the authorisation code, because there is no second path for
one to live in.

A session may be granted at view, comment or edit, and never at full. Full
includes changing who has access, so an operator holding it could extend their
own session.

**Access stops the moment the time is up**, on the next thing the operator
does, rather than whenever a background job next runs. The job still runs, and
what it does is tidy up: it closes the session and suspends the membership so
the customer's screen stops saying somebody is inside.

The workspace keeps the whole record: who asked, why, who said yes, how long
for, when it ended and how. The grant and the end are both in the workspace's
own audit trail.
