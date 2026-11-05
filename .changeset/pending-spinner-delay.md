---
"@openokr/web": patch
---

A button's spinner waits 200 milliseconds like the bar at the top, so a fast save shows nothing. A button waiting on the server is refused with aria-disabled instead of disabled, so it keeps keyboard focus.
