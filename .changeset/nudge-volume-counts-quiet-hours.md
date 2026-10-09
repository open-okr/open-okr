---
"@openokr/core": patch
---

Nudge volume counts what quiet hours held back.

A reminder due inside a member's quiet hours waits for the window to end,
which is right, but Nudge volume's "Why it stayed quiet" never listed quiet
hours, so an administrator could not see that anything had waited. It now
counts them under "Quiet hours".
