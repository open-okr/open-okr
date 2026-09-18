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
