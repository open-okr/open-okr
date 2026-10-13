---
"@openokr/web": patch
"@openokr/ui": patch
"@openokr/core": patch
"@openokr/formats": patch
"@openokr/importer": patch
---

Date ranges say when they do not fit.

An initiative's start and end, a member's leave, a space's holidays and the
audit filter are now one range: the end's calendar opens from the start, and
an end before the start says so under the end straight away.

An initiative that ends before it starts is refused with a sentence instead of
a database error, on creation and when either date changes. This applies to
API clients too.

Imports no longer fail on such an initiative. Both the FlowyTeam and the
spreadsheet importer keep its start, leave out the end, and name each one in
the report, with both dates.

The audit filter's days now run midnight to midnight in the workspace's
timezone, the zone the rows are shown in, instead of in UTC. The screen says
which zone.

A form that adds one row after another (a key result, a KPI reading, a task,
an initiative) is empty again after each save. Before, a date, a number, a
confidence or a unit typed into the last row stayed in the form and was sent
with the next.
