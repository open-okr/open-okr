---
"@openokr/web": patch
"@openokr/core": patch
---

A refused save says why.

Four forms failed quietly. An operator's lifecycle change and a site message
left the form as it was when refused, and an administrator's edit of somebody
else's name, title or manager threw its answer away, so a refused save and a
saved one looked the same. Each now says why under its button, keeps what was
typed so it can be corrected, and says so when it worked.

An operator's plan change no longer goes to the error page when a value is
refused, and a refused support request now says the refusal in a sentence
instead of as raw validation output.

For API clients: a member's name of only spaces is refused with "A member
needs a name."
