# Importing

Two importers. Both read their source strictly read-only, both are a dry run
unless you say otherwise, and both are safe to run twice.

| From | Use |
|---|---|
| A spreadsheet | `pnpm import:csv`, or the wizard under Admin, then Import |
| FlowyTeam | `pnpm import:flowyteam` |

## The rules both obey

**Read-only at the source.** The FlowyTeam connector opens its session read
only and checks every statement against an allow list before sending it, so
neither a write nor a table lock leaves the process.

**A dry run unless `--write`.** The dry run reports exactly what the real run
would write, because the two share every line of code up to the call.

**Idempotent.** Every imported row keeps the identifier it came from, unique
per workspace, so running the same import twice updates rather than duplicates.

**Somebody owns it.** `--as <email>` names the member every write is authorised
as. There is no ambient importer identity, and the audit rows name whoever ran
it.

**Nothing derived is trusted.** Progress, health, achievement, alignment
scores, next check-in dates and streaks are recomputed after the load rather
than copied. A number carried across from another system is a number nobody
can defend.

**Nothing is silently dropped.** A row that cannot be mapped is named in the
report with its line in the file.

## From a spreadsheet

```sh
pnpm import:csv --entity goals --file goals.csv \
  --workspace acme --as somebody@acme.com
```

Add `--write` when the dry run looks right.

If your headers are not recognisable, `--map mapping.json` names the columns.
The wizard under **Admin, then Import** does the same thing with a proposed
mapping you confirm, a preview, and a per-row error report.

Exit 2 is a usage error. Exit 1 means some rows were skipped, and the report
names each one.

### Templates

Start from a template rather than a blank sheet. The wizard under **Admin,
then Import** offers one beside its choice of what the file holds, as a CSV
file and as an Excel workbook. Anybody with full access can also fetch them
from these addresses on your instance:

| Holds | CSV | Excel |
|---|---|---|
| Objectives | `/admin/imports/templates/goals.csv` | `/admin/imports/templates/goals.xlsx` |
| Key results | `/admin/imports/templates/key-results.csv` | `/admin/imports/templates/key-results.xlsx` |
| KPIs | `/admin/imports/templates/kpis.csv` | `/admin/imports/templates/kpis.xlsx` |
| KPI values | `/admin/imports/templates/kpi-records.csv` | `/admin/imports/templates/kpi-records.xlsx` |
| Initiatives | `/admin/imports/templates/initiatives.csv` | `/admin/imports/templates/initiatives.xlsx` |
| Tasks | `/admin/imports/templates/tasks.csv` | `/admin/imports/templates/tasks.xlsx` |

Each template is a header row and one example row. The headers are the column
names in the tables below, exactly, so the importer recognises every column
without a mapping. Keep the headers, replace the example with your own rows,
and add as many as you need.

**Import them in the order of that table.** Each file finds the rows the files
before it wrote by their identifiers: the example key result points at the
objective `OBJ-1`, the KPI value at `KPI-1`, the initiative at `KR-1`, and the
task at `INIT-1`.

**The example names people and a space you probably do not have.** The people
are `alex@example.com` and `sam@example.com` and the space is `Product`.
Replace them with your own members' email addresses and your own space names,
or the dry run skips the example row and names what it could not find.

**Required columns are listed here, not marked in the file.** A header such as
`title *` would stop matching the column it names. The wizard lists the
required columns beside the download too.

Dates are written `YYYY-MM-DD`. An empty optional cell takes the default its
row below describes.

#### `goals`

Objectives, one per row, with their champion and their reviewer.

| Column | Required | What it holds |
|---|---|---|
| `externalId` | Yes | The identifier the source system uses for this objective. Re-running the file finds this row by it rather than creating a second one. |
| `title` | Yes | The objective itself. |
| `description` | No | Context, as plain text. Blank lines separate paragraphs. |
| `level` | Yes | One of: company, department, team, individual. |
| `cycle` | No | The cycle this objective belongs to, by name or label. Leave it empty and give a start and an end instead. |
| `startsOn` | No | The first day, when the objective carries its own timeframe. |
| `endsOn` | No | The last day, when the objective carries its own timeframe. |
| `space` | No | The space that owns it, by name. Leave it empty for a workspace-level objective. |
| `champion` | Yes | The member who runs it, by email address. |
| `reviewer` | Yes | The member who reviews it, by email address. |
| `parent` | No | The objective this one aligns to, by its identifier in this same file or by its id here. |
| `weight` | No | How much of the parent this objective carries. One by default. |

#### `key-results`

Key results, one per row, each against an objective.

| Column | Required | What it holds |
|---|---|---|
| `externalId` | Yes | The identifier the source system uses for this key result. |
| `goal` | Yes | The objective it measures, by the identifier the goals file used or by its id here. |
| `title` | Yes | The measure itself. |
| `direction` | Yes | One of: increase, reduce, maintain, move. |
| `indicatorType` | No | One of: leading, lagging. Lagging by default. |
| `unit` | No | What the numbers are in, such as % or customers. |
| `baselineValue` | Yes | Where it started. |
| `targetValue` | Yes | Where it has to reach. |
| `currentValue` | No | Where it is now. The baseline, if the file does not say. |
| `dueOn` | No | The day it is measured to. |
| `owner` | No | The member who owns the measure, by email address. |
| `weight` | No | How much of the objective it carries. One by default. |

#### `kpis`

KPIs, one per row, with their frequency and their corridor.

| Column | Required | What it holds |
|---|---|---|
| `externalId` | Yes | The identifier the source system uses for this KPI. |
| `title` | Yes | What is being measured. |
| `frequency` | Yes | How often it is recorded. One of: daily, weekly, monthly, quarterly, yearly. |
| `direction` | No | One of: higher_better, lower_better. Higher is better by default. |
| `indicatorType` | No | One of: leading, lagging. Lagging by default, and flagged for review. |
| `tier` | No | One of: input, output, outcome, impact. Output by default. |
| `aggregate` | No | How a period's values combine. One of: sum, avg, max, min, count. |
| `unit` | No | What the numbers are in. |
| `space` | No | The space that owns it, by name. Leave it empty for a workspace-level KPI. |
| `targetDefault` | No | The target every period gets when a record does not carry one. |
| `healthyPct` | No | Achievement at or above which the KPI is healthy. The canon default when empty. |
| `watchPct` | No | Achievement at or above which the KPI is on watch. The canon default when empty. |

#### `kpi-records`

KPI values, one row per KPI per period.

| Column | Required | What it holds |
|---|---|---|
| `kpi` | Yes | The KPI, by the identifier the KPI file used, by its short id, or by its id here. |
| `on` | Yes | Any day inside the period. The period itself is worked out from the KPI's frequency. |
| `actualValue` | No | What was achieved. Leave it empty to record a target only. |
| `targetValue` | No | The target for this period. The KPI's default when empty. |
| `remark` | No | A note on the period. |

#### `initiatives`

Initiatives, one per row, each in a space and owned by a member.

| Column | Required | What it holds |
|---|---|---|
| `externalId` | Yes | The identifier the source system uses for this initiative. |
| `title` | Yes | What the work is. |
| `description` | No | Context, as plain text. |
| `space` | Yes | The space the work sits in, by name. |
| `owner` | Yes | The member who owns it, by email address. |
| `status` | No | One of: planned, active, done, dropped. Planned by default. |
| `startsOn` | No | The first day. |
| `endsOn` | No | The last day. |
| `confidence` | No | Confidence from 0 to 1, when the source records one. |
| `keyResult` | No | The key result this initiative moves, by the identifier the key results file used. |

#### `tasks`

Tasks, one per row, each in a space and on a board column.

| Column | Required | What it holds |
|---|---|---|
| `externalId` | Yes | The identifier the source system uses for this task. |
| `title` | Yes | What has to happen. |
| `description` | No | Detail, as plain text. |
| `space` | Yes | The space the task sits in, by name. |
| `status` | No | The board column. One of: backlog, todo, in_progress, done. Backlog by default. |
| `dueOn` | No | The day it is due. |
| `initiative` | No | The initiative it belongs to, by the identifier the initiatives file used. |
| `keyResult` | No | The key result it moves, by the identifier the key results file used. |
| `assignee` | No | The member doing it, by email address. |

These tables are checked against the importer itself, so a column it gains or
loses fails the build until this page says so too.

## From FlowyTeam

```sh
pnpm import:flowyteam \
  --source mysql://user:password@host:3306/database \
  --workspace acme --as somebody@acme.com --company 8257
```

Run it without `--company` first and it lists what the source holds. There is
no default, because one real instance holds company 8257 among others and
guessing would import a stranger's quarter.

**A workspace holds one company for good.** A second one is refused by name.

It brings across people, spaces and space membership, cycles, objectives, key
results and their history, check-ins, KPI categories and KPIs with their
records, initiatives, tasks, checklists, task comments and watchers.

| Flag | For |
|---|---|
| `--write` | Make it real. Without it, a dry run |
| `--only <domains>` | A comma-separated subset: organisation, objectives, checkins, kpis, work, collaboration, files. A domain brings whatever it depends on, and the report says which it added |
| `--files-root <path>` | The FlowyTeam server's storage directory. Task files live on that server's disk rather than in MySQL, so without this they are reported by name instead of copied |

An image sitting inline in comment markup needs no directory: those bytes are
in MySQL.

### What it does not bring across yet

Some FlowyTeam tables are not read at all. Every run, the dry run included,
counts each of them for the company and names every one that holds rows, under
**Not read by this import** in the report, with a sentence on what it holds.
A table with no rows for the company is not mentioned.

Whether to import each one is an open decision, not a default. Until it is
made, nothing from these tables is approximated or partly carried: the rows
stay in FlowyTeam, and the report says so every time.

| Source table | What it holds | Where it could land |
|---|---|---|
| `employee_teams` | A second, older list of who belongs to which team. It has no company column, so it is counted through the team | Space membership, beside `other_departments`, if it names anybody that one does not |
| `performance_settings` | The company's OKR settings: cycle type, which objective levels are allowed, caps on objectives and key results, colour thresholds, terminology labels, and who may edit what | The labels could become this workspace's terminology labels. The caps and thresholds are the method's to set, so a person decides whether any carries across. The edit matrix has no home: access here is granted per goal, space or KPI rather than by role |
| `objective_accesses` | Who else may see or update each objective | Access on the imported goal |
| `objective_discussions` | Comment threads on objectives | Comments on the goal, with replies kept |
| `keyresult_discussions` | Comment threads on key results | Comments on the key result, with replies kept |
| `keyresult_indicator` | Which KPIs each key result is linked to. It has no company column, so it is counted through the key result | The KPI a key result reads. A key result here reads one KPI, so one linked to several needs a rule for which |
| `checkins` | Each person's check-in session: a mood score and answers to the check-in questions. The objective and key result check-ins inside it do import | No home for the mood. The answers could be added to the narrative of the check-ins from the same session, which changes what an imported check-in says |
| `key_result_files` | Files attached to key result check-ins | Attachments on the imported check-in, copied the same way task files are |
| `indicator_accesses` | Who else may see or update each KPI | KPI shares |
| `indicator_calculates` | Which KPIs each calculated KPI is worked out from | Already lands: the same links are rebuilt from each KPI's own formula. Nothing to decide unless the two disagree |
| `task_boards` | The named boards tasks were organised on. Each task still takes its status from its board column | No home: a board here is a view of a space, an initiative or a key result, not something with a name |
| `task_category` | The category each task was filed under | No home: a task has no category or label, and custom fields are not in this version |
| `project_time_logs` | Time logged against projects and tasks | No home: time tracking is not in this version |
| `performance_records` | The score FlowyTeam stored for each owner when a cycle closed | No home by design: this product works out its own results when a cycle closes and never takes them from a source |
| `reward_settings` | How OKR, KPI and attendance results turned into points | The points layer's settings, only if the points layer is built at all. It is off by default either way |
| `scores` | The points each person, team or company was awarded | The points ledger, on the same condition |

If you need any of these before a decision is made, keep the FlowyTeam
database readable after cutover. The report names what is there, and the
source is where it stays.

## Afterwards

Read the report before you tell anybody the import worked. Then check three
things in the product: that the people are the right people, that the cycle
dates are the ones you expected, and that a goal's history looks like its
history.

The [migration cutover runbook](../runbooks/migration-cutover.md) is the
procedure for doing this for real, with a rehearsal first.

## Next

- [Administrator guide](../admin/README.md)
- [Migration cutover](../runbooks/migration-cutover.md)
