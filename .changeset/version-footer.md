---
"@openokr/web": minor
"@openokr/core": minor
---

Administrators see the running version at the bottom of the sidebar, and a link to the newest GitHub release when the instance is behind it. The check asks GitHub at most once a day, never delays a page and sends nothing about the instance. It is off on a managed cloud, and an administrator turns it off in Admin, General, or the operator with `OPENOKR_UPDATE_CHECK=off`.
