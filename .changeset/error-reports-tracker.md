---
"@openokr/web": minor
---

An instance can now send its unexpected errors to any tracker that speaks Sentry's protocol (Sentry, self-hosted Sentry, GlitchTip or Bugsink): set `OPENOKR_ERROR_DSN` to the tracker's DSN and restart. Nothing is sent unless it is set. `OPENOKR_ERROR_ENVIRONMENT` (default `production`) keeps a staging instance apart. A value that is not a DSN stops the instance starting and names the variable. Reports never slow a request, and the new `openokr_error_reports_dropped_total` metric counts any the tracker did not get. Helm takes the DSN from a Secret named in `errors.existingSecret`.
