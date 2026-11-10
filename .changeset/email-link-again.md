---
"@openokr/web": minor
---

A person whose confirmation email never arrived is no longer stuck. Where the instance sends mail, the link is queued and sent by the relay rather than inside the sign-up request, so a mail server that refuses it never fails the sign-up and the send is retried. "Send the link again" is offered on the check-your-email card, on the page an expired or broken link opens, and beside "Confirm your email first" on sign-in, with the same answer whether or not the address has an account, and held at one link a minute and five a day for any address and five requests a minute from one network. Signing up again with an unconfirmed address sends a fresh link. A link now works for 24 hours rather than one, and the mail says so. A completed password reset confirms the address and signs every device out. Confirming an address writes `auth.email_verified` to the instance audit chain, and `openokr_verification_links_total` counts the links.
