---
"@openokr/web": patch
---

A new tab no longer loads its first page twice. The page and the version check now agree on the running build when APP_BUILD_ID is unset, so signing in shows Home once.
