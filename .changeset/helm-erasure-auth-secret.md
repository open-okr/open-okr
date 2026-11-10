---
"@openokr/web": patch
---

The Helm chart's erasure CronJob now starts. It was given the database and the encryption key but not the server's auth secret, which its command needs in production, so every scheduled run stopped before it read anything and no closed workspace was ever erased.
