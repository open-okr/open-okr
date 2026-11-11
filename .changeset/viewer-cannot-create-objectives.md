---
"@openokr/core": patch
"@openokr/web": patch
---

A member with the Viewer role can no longer create an objective. A company-level or personal objective was checked against the access every member holds on the workspace for their own settings, so a Viewer was offered "Start drafting", "Add objective" and "New objective", and the objective was created. Creating one now asks the role's level on goals, as KPIs and comments already did, and every screen that offers it asks the same question. Owners, Admins and Members create as before.
