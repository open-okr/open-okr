---
"openokr": minor
---

The annual cycle can be created and opened from the cycle screen, and the
mid-cycle calibration can be recorded there.

- The cycle screen's header has a Quarterly and Annual toggle, and a picker
  for any cycle in that horizon, including next quarter or next year before
  it starts. Creating a cycle makes one in the horizon you are looking at and
  opens it. Before this the screen only ever showed and made the quarter, so
  the annual frame's own cycle could not be reached.
- Links inside the cycle screen stay on the cycle you opened, rather than
  falling back to the quarter.
- Phase 6 has a form to record the one mid-cycle calibration a cycle allows,
  with its written reason, under the METHOD.md §7.6 rule in the method's own
  words. Once recorded, it shows the reason, who recorded it and when, and the
  form goes away. A closed cycle cannot be calibrated, and an unknown cycle is
  refused as "No such cycle" rather than failing on a database constraint.
- Creating a cycle without naming a cadence keeps making quarters after an
  annual cycle exists. It used to follow the newest cycle, so opening next
  year's annual cycle turned the next "create" into another year.
- The `cycles.create` action takes an optional `mode` (`annual` or
  `quarterly`), and `workflow.read` returns the cycle's `calibration`.
