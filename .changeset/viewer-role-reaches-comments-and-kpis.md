---
"@openokr/core": patch
---

A member holding the Viewer role can no longer post comments, react, or
create and change KPIs and initiatives. Those writes named no subject, so they
were measured on the workspace, where every member holds edit for their own
profile and notifications, and the role was never read. They are now measured
by what the member's role grants on the comment, KPI or initiative domain.
Members holding the Member role keep everything they had, and a Viewer still
manages their own profile, notifications and tokens.
