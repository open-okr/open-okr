---
"@openokr/web": patch
---

An instance that has not set up mail no longer writes password-reset links,
address confirmations or invitation links into its log.

The console mail driver, the default until `mail.transport` is set to SMTP,
now logs only the masked recipient and the subject in production, which is
enough to see that mail is being attempted and going nowhere. A development
machine still logs the whole message, because there the link is how a
developer signs in.
