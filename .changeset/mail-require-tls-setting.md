---
"@openokr/web": patch
"@openokr/core": patch
"@openokr/adapters": patch
---

A mail relay without TLS can be used when somebody chooses to.

The instance always required STARTTLS, so a local relay such as Mailpit,
which the staging guide recommended, failed every send. A new instance
setting, `mail.requireTls` (`OPENOKR_MAIL_REQUIRE_TLS`), turns that off. It
stays on by default, and the staging guide says when not to turn it off.
