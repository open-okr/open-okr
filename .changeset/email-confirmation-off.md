---
"@openokr/web": minor
---

An administrator, or on a cloud the operator, can now turn off email confirmation at sign-up: Email confirmation at sign-up on Admin, General (or the console's Instance screen), or `OPENOKR_EMAIL_VERIFICATION=off`. With it off, a new account is signed in at once and sees a welcome saying it is ready, with nothing about confirming. Where the instance can send mail, a confirmation link is still sent, worded as optional, because joining a workspace by company email domain needs a confirmed address. It cannot be turned off while registration is limited to company domains. Sign-up on an instance that sends no mail now ends on the same welcome instead of going straight to the home page.
