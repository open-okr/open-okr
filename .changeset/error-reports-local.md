---
"@openokr/web": minor
---

Every unexpected server error is now one JSON line on stderr (`"kind":"error.report"`) and a count in the new `openokr_errors_total` metric, by where it was caught. The line names the class, the digest the error page showed, the route pattern, the action, the workspace and a scrubbed stack, and withholds any message that could quote what somebody typed. Refusals and Next's own redirects are not errors and write nothing. One error is written at most ten times a minute. Nothing leaves the host.
