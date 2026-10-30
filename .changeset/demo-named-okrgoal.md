---
"@openokr/web": patch
---

The public demonstration instance calls itself OKRGoal in the browser tab and
on the sign-in page, instead of "OpenOKR demo". `OPENOKR_INSTANCE_NAME` still
overrides it, and a name saved in Admin still wins over both.
