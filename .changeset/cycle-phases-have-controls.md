---
"@openokr/web": minor
---

Every planning phase of a cycle can now be completed from the browser.

Several things the cycle's phases check had no control on any screen, so
those phases could never turn green and every publish needed an override:

- **Phase 1:** name the sponsor and facilitator, book the four planning
  sessions, and declare a first cycle.
- **Phase 2:** record baseline health in its three columns: stable,
  declining, business as usual.
- **Phase 3 (quarterly):** revalidate the annual frame, and choose which of
  the year's key results this quarter focuses on.
- **Phase 5:** record what was cut, which capacity gate 5 requires.

A quarter now finds its year's key results by the calendar, so a quarter
under a year with key results is asked to choose among them rather than
getting by with a note. A sponsor or facilitator must be an active person in
the workspace. New API action: `workflow.setFocusKeyResults`.
