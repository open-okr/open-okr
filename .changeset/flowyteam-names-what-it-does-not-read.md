---
"openokr": patch
---

The FlowyTeam importer now names every source table it does not read.

The connector checked that fifteen FlowyTeam tables existed, then read none of
them and said nothing, and it never looked at time logs at all. So a company's
objective discussions, KPI sharing, key result files, task categories, time
logs, points and several settings were left behind without a word. That is the
silent drop the importer is never supposed to make.

Every run, the dry run included, now counts each of those tables for the
company being imported and names every one that holds rows, with the count and
a sentence on what it holds and why it is not imported yet. The summary at the
top of the report says how many there are. A table with no rows for the company
is not mentioned. Nothing new is read beyond one count per table, and the
source is still opened read-only.

Whether to import each of them is an open decision. The import guide lists them
with where each could land in OpenOKR, or says there is nowhere for it.

An instance missing a table nobody reads, such as an older FlowyTeam without
discussion tables, is no longer reported as a domain that will import nothing.
