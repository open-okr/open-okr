---
"@openokr/web": patch
"@openokr/core": patch
"@openokr/ui": patch
---

The Admin > Import connect step and the import report now name the source OKRI.io instead of FlowyTeam, and connecting defaults to https://okri.io. A new instance setting, `imports.flowyteam.displayName` (environment `OPENOKR_FLOWYTEAM_NAME`, default OKRI.io), changes the name shown on screen and in reports. Action names, routes, environment variables and stored values are unchanged. The spreadsheet import card now comes first on Admin > Import.
