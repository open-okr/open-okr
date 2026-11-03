---
"@openokr/web": minor
"@openokr/core": minor
"@openokr/formats": minor
---

An administrator can now choose who may create an account from Admin > General > Registration. The choices are Invitation only, Company email addresses and Anyone. Under Company email addresses, a company address can sign up and start a workspace. A Gmail, Yahoo, Outlook or other free mail address is refused with the reason, unless an invitation admits it. Every change is written to the instance audit chain. `OPENOKR_REGISTRATION` is now read when nothing has been saved in the application. A free mail provider can no longer be added as a trusted email domain.
