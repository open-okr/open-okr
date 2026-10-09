---
"@openokr/web": patch
"@openokr/ui": patch
---

A timezone is chosen from a list rather than typed.

The welcome wizard, Admin > General and your profile now offer every timezone
the server knows, each shown with its city, its offset today and its name, and
grouped by region. Type a city, an offset such as `+8` or `GMT+8`, or the zone's
everyday name ("Malaysia Time") to find one, and use this device's zone in one
press. A timezone saved before that is not on the list still shows, marked, and
nothing is changed until you pick another.

The server now accepts only a name on that list. It used to accept anything the
runtime could resolve, such as `EST`, `+08:00` or a name in the wrong case, and
stored it exactly as typed.
