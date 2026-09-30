---
"@openokr/web": minor
---

The spreadsheet importer offers a template for each kind of row, as a CSV file
or an Excel workbook.

Under Admin, then Import, the wizard now shows two links beside its choice of
what the file holds, and lists the columns that kind of row cannot do without.
Each template is a header row and one example row. The headers are the
importer's own column names, so a filled-in template maps every column with no
questions asked. The same files are at `/admin/imports/templates/<entity>.csv`
and `.xlsx` for anybody with full access, and the imports guide lists every
column and what it holds.

The six examples name each other, so importing them in order (objectives, key
results, KPIs, KPI values, initiatives, tasks) resolves every reference they
make. Getting that right found two faults, now fixed: importing an initiative
you own yourself, or a task assigned to you yourself, failed every time with a
database error, from a spreadsheet and from FlowyTeam alike.
