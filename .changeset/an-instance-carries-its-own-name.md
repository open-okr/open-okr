---
"@openokr/web": minor
---

An instance now carries the name its operator gave it, everywhere a person
sees one.

`OPENOKR_INSTANCE_NAME` and the setup wizard's name field were both stored and
never read. Every tab, heading, email and chat message said "OpenOKR" whatever
the instance was called, and the public demo, which sets the variable to
"OpenOKR demo", said "OpenOKR" on every page.

The name now reaches the browser tab, the sign-in and setup headings, the error
page shown when the app cannot start, the feed's name for the product acting,
the chat linking prompt and its reply, password-reset and address-confirmation
emails, invitations, every nudge and the morning summary, the blocker card, the
channel test message, the command line's consent screen and connections list,
the name an AI client shows for the agent endpoint, the title of the live API
document, and the app name an AI provider's dashboard lists. With nothing set,
all of them still say "OpenOKR".

The wizard pre-fills the name the instance already has and stores one only
when you type a different name. It used to pre-fill "OpenOKR" and store
whatever the field held, which silently replaced the variable for good.

General in admin gains the name on a self-hosted instance. A name saved there
wins over the variable; clearing the field hands the choice back to it. Every
rename is recorded on the instance audit chain. Authenticator apps and passkey
prompts show a new name after the next restart, and the card says so. On a
managed cloud the name belongs to the operator and the card is not shown.
