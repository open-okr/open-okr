# Backups in workspace admin

Status: approved by Akmal on 9 November 2026 ("design approved"), Q1 as proposed (no instance backup record in 0.7.0), and built at release 0.7.0 (plan U3). The restore card links `docs/runbooks/migration-cutover.md`, the cutover runbook's real name.

Authority: REQUIREMENTS §4 Pillar F ("backups" in Admin) and §7's reliability line ("per-workspace logical restore through the portability engine"); UIUX-PLAN S-36 ("backups, import wizards and workspace export"); `backup-verification.md`; `tenant-lifecycle.md` §6 and §10.

## 0. What exists

| Piece | Where | Today |
|---|---|---|
| Instance backup | `deploy/docker/openokr` (`backup`, `verify-backup`, `restore`); `deploy/helm/templates/backup-cronjob.yaml` | `pg_dump` of the whole database, every workspace in one file, encrypted with the instance root key, written to the host or a volume |
| What the application knows of it | Nothing | No table, setting or route records a backup. The application container does not mount the backup directory |
| The workspace archive | `workspace.exportArchive`, `packages/core/src/actions/portability.ts:61` | One workspace, sealed with a passphrase the person keeps, `full` access, audited, an `export_runs` row of kind `archive` with its row count. The bytes are returned once and not kept |
| Its card | `apps/web/app/admin/imports/export-card.tsx`, on Import and export | The only place an administrator takes one |
| Restoring an archive | `workspace.importArchive`, `packages/core/src/actions/portability.ts:263`; `packages/core/src/portability/import.ts` | Gives every row a fresh id. Into the workspace it came from, it would add a second copy of everything |
| Export while frozen | `tenant-lifecycle.md` §10, done | A suspended or closed workspace can still take its archive |
| The admin sections | `packages/core/src/modules/registry.ts:397-551`; `apps/web/app/admin/layout.tsx` | Every section needs `full`. No Backups section |
| Cloud or not | `isCloudEnabled`, as Admin, General reads it (`apps/web/app/admin/general/page.tsx:64`) | |

## 1. The access question

| Who | An instance backup | Their workspace's archive |
|---|---|---|
| A workspace administrator, self-hosted | Told where backups come from and where the restore guide is. Cannot see, start, download or restore one from the screen | Take one, see every one taken |
| A workspace administrator, cloud | Told the provider backs up the service. Nothing about the provider's schedule, storage or keys | The same |
| The person who runs the server | `./openokr` and the chart, as today | |

**An instance backup is never a workspace's to touch.** It holds every workspace and is sealed with the instance key. Downloading it would hand one customer everybody's data; restoring it would roll every other workspace back too. On a self-hosted instance the administrator is often the person who runs the server as well, and they already have the command line for that, which is the right door: it sits behind host access, not a web session.

**A workspace's own backup is its archive.** REQUIREMENTS names per-workspace restore "through the portability engine", and the archive is that engine's output.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| U1 | **A Backups section at `/admin/backups`**, `full` access, on every instance | S-36 lists it. `full` because the archive is the whole workspace (`portability.ts` says why) |
| U2 | **First card: the workspace archive.** The existing export card moves here from Import and export, which keeps list exports and the archive import and links here | One place to take a copy. Two doors to one action would drift |
| U3 | **Second card: archives taken.** Every `archive` run in the workspace, newest first, the last 50: who, when, the filename, the rows it held. A new read action, `workspace.archiveHistory`, at `full`, in the agent catalogue's admin toolset beside the export | Every administrator's, not only the reader's: somebody taking the whole workspace is something the others should be able to see without searching the audit log. It says the file itself is not kept, so it cannot be downloaded again |
| U4 | **Third card: restoring.** Words and links, no button. A copy is restored into a new, empty workspace through the archive import, and the cutover runbook is the procedure | Importing into the same workspace duplicates it (§0). A button that did that would be a trap |
| U5 | **Fourth card: this instance's backups, self-hosted.** Says the server's operator takes them with `./openokr backup` or the chart's backup job, that each holds every workspace, and links to `docs/runbooks/restore.md`. No status | The application never sees a backup, so any status here would be invented. Q1 asks whether to change that |
| U6 | **The same card on a cloud** says the provider backs up the service, and links `instance.supportEmail` when it is set. Nothing else about the provider's backups | How a provider keeps backups is theirs to state in their terms, not this screen's |
| U7 | **It works in a suspended or closed workspace.** The closed-workspace banner links here | That is when an administrator most needs the archive, and the export is already allowed then |
| U8 | No migration, no setting | The archive and its run rows exist |

## 3. Open question

**Q1. Should the instance record its backups, so the screen can show when the last one ran?** Proposed: **not in 0.7.0, and as its own design if yes.** It needs `./openokr backup` and the chart's job to write a row the application can read: an instance table with no workspace data (started, finished, outcome, schema version, verified), written by a small command in the application image rather than by `psql` from a shell, so the write goes through code the boundary gates can see. A self-hosted administrator would then see "Last backup: 03:00 today, verified Sunday"; on a cloud, only the operator console would show it. Without it, the screen states where backups come from and claims nothing it cannot check.

## 4. Acceptance criteria

- Given a member with `full` access, when they open Admin, then Backups is in the section list; a member below `full` gets not-found at `/admin/backups`.
- Given a self-hosted instance, when the page renders, then the instance card names `./openokr backup` and the chart's backup job, links the restore guide, and shows no date, size or file of any instance backup.
- Given a cloud instance with `instance.supportEmail` set, when the page renders, then the instance card says the provider backs up the service and links that address, and names no command.
- Given an administrator takes an archive with a passphrase, when the page reloads, then the history's first row names them, the time and the row count.
- Given two administrators who each took an archive, when either opens the page, then both rows show.
- Given a closed workspace, when an administrator opens Backups and takes an archive, then it succeeds.
- Given the Import and export page, when it renders, then it has no archive export card and links to Backups.
- Given the page with no archive ever taken, then the history says none has been taken yet, rather than showing an empty table.

## 5. Tests

| Kind | File | Covers |
|---|---|---|
| Integration | `packages/core/test/portability-archive.test.ts` (existing) | `workspace.archiveHistory`: every administrator's runs, `full` only, list exports excluded |
| Browser | `e2e/s36r-backups.spec.ts` (new) | The four cards, taking an archive, the history row, the empty state |
| Browser | `e2e/s36j-workspace-archive.spec.ts` (existing) | Moves to the Backups page |
| Browser | `e2e/s43-accessibility.spec.ts` (existing) | Scans the new screen by itself, because its list walks `apps/web/app` |

## 6. Documents changed in the same change

- UIUX-PLAN S-36: Backups as its own section with the four cards; "workspace export" points there.
- `docs/admin/operations.md`: what Backups shows and how restoring works for a workspace.
- `docs/runbooks/restore.md`: one line saying workspace administrators see no instance backup.
- The contract artifacts, regenerated for `workspace.archiveHistory`.
- `packages/ui/src/i18n/messages/en.json` and `ms.json`.

## 7. What this does not do

- No instance backup is shown, taken, downloaded or restored from a workspace screen.
- No restore of one workspace from an instance backup. That is operator tooling, if anybody designs it.
- No re-download of an earlier archive: the bytes are not kept, by design.
- No schedule for archives. Taking one stays a person's act.
