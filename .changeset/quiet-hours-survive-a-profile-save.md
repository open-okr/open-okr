---
"@openokr/web": patch
---

Saving your profile no longer deletes your quiet hours.

The quiet-hours boxes on your profile were always empty, even when a window
was set, and two empty boxes mean "off". So saving anything on the profile,
such as a new timezone, turned quiet hours off, and nudges could reach you at
night. The boxes now show the saved window. On both the profile and Where to
reach you, filling in one time without the other is refused with a message,
instead of being read as "off".
