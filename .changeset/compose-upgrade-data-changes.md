---
"@openokr/web": minor
---

`./openokr upgrade` on Docker Compose runs the data changes the release brought, once the instance is healthy again, to the end, and prints what ran, as the Helm chart's hook does after each upgrade. Nobody has to remember `./openokr data-change` any more. A script that fails leaves the upgrade done and the instance serving, names the script and exits non-zero. `OPENOKR_SKIP_DATA_CHANGE=1` leaves them for later and prints what is pending, as `./openokr status` does.
