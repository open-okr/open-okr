---
"@openokr/core": patch
---

The "your password changed" and "a change of sign-in email was asked for" mails give the time in the person's own timezone and name it, such as "at 15:05 (Asia/Kuala_Lumpur)", instead of in UTC. The timezone is the one the person set in their first workspace, then that workspace's own, then UTC.
