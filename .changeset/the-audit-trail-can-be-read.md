---
"openokr": minor
---

The audit trail can be read on the admin screen, not only verified and
exported.

Admin, then Audit trail, now lists the trail newest first, fifty rows at a
time with older rows a click away. Each row says when (in the reader's own
time zone, which the column names), who acted and through which channel when
it was not the browser, the action, the target, and its position in the chain
or that it is still waiting for one. A row's details stay out of the list; the
export carries them and records that it was taken.

- **One filter for the list and the file.** A date range, an action, a person
  or agent, and a target type. Show matching rows draws them; Export as CSV
  takes the same rows away. The person filter is new to the export too.
- **Administrators only**, as the rest of the screen is. The read behind it,
  `audit.list`, is also on the REST surface, the command line
  (`okr audit list`) and the agent endpoint, refused below full access
  everywhere.

The database gains one index, migration 0105, on the audit trail's workspace,
time and id, so a page is read from the index rather than by sorting the whole
trail.
