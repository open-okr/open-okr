---
"@openokr/web": minor
---

Drafting on the cycle screen now waits until the planning phases are done.

The requirements say that drafting in phase 4 is refused, with the reason,
while an earlier phase is incomplete. Before, the screen only showed a banner
and let drafting go ahead. Now the add forms give way to a note, and the
server refuses a draft from the cycle screen and names each missing item.
Goals added anywhere else, by import, from a template or through the API
without the new `guided` flag, are not held up. Each goal's progress bar on
the drafting screen is now named after its goal for screen readers.
