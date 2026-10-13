---
"@openokr/web": patch
"@openokr/ui": patch
"@openokr/core": patch
"@openokr/formats": patch
---

Times say whose clock they are on.

A site message's window is now read on the operator's own clock. Before, the
two times were read in the server's zone, so a message set for 09:00 in Kuala
Lumpur on a server running in UTC went up at 17:00 there. The form names the
zone beside each time.

Scheduling a session names the workspace zone beside its date and time, and
booking a cycle beside its hour. The daily summary's time has a full label and
names your own zone.

Quiet hours, on the profile and on Where to reach you, open on the saved
window, which may run overnight (22:00 to 07:00). Setting one time without
the other is held back with a message under the empty one, instead of being
sent and refused.

A save on a form now leaves it showing what was just saved. Before, the quiet
hours just saved could be shown as the ones they replaced.

For API clients: quiet hours, the daily summary time and a cycle booking's
time follow one rule. A time is HH:MM from 00:00 to 23:59. "9:30" is accepted
and stored as "09:30", and a time such as "99:99", which quiet hours used to
accept, is refused with a message.
