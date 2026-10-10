---
"@openokr/web": patch
"@openokr/ui": patch
---

One-time codes are typed one character per cell, and send themselves.

The six-digit code at sign-in and when turning on an authenticator, and the
backup code, are now drawn as cells, one per character. Typing fills them in
order, pasting fills them all whatever separates the characters, and the code
is checked as soon as the last cell is filled, with no button to press. A code
that is refused empties the cells and says why, ready for the next one. A
phone's one-time-code autofill and a password manager still see one field.

The terminal login page, opened without the link, now takes the code the
terminal printed, typed into the same cells: it upper-cases what is typed and
drops the characters the codes never use. It does not send itself, because the
next page says which terminal is asking before anything is granted.
