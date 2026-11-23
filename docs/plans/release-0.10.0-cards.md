# Task cards: release 0.10.0

Cards for the implementing agent. The designs are approved and final: [kpi-access](../design/kpi-access.md) (slices K1 to K8, §13) and [languages](../design/languages.md) (slices S1 to S20, §18). Every open question in both is answered as that document recommends. The plan is [release-0.10.0](release-0.10.0.md).

## How to use these cards

1. One card is one commit on branch `feat/0.10.0-build`. Never commit on another branch.
2. Do the cards strictly in the order of this file. Never start a card before the one above it has its "Done:" line filled.
3. Read the design sections a card names before writing anything. Cite them, do not reinterpret them.
4. Never change a design, the plan or a card. Three exceptions, each named in the card that needs it: the plan's §9 build log row, the measured-bytes cells in languages §4.3 and §10.3, and this file's "Blocked:" and "Done:" lines.
5. If a card cannot be done as written and no ruling covers it, write the problem under that card's "Blocked:" line, leave the work uncommitted, and stop entirely. Do not work around it and do not start the next card.
6. When a card's commit exists and `pnpm check:fast` is green, fill its "Done:" line with the short commit hash (`git rev-parse --short HEAD`). Never stage this file in a card's commit. R1 commits it.

## Before the first card

1. `cd /Users/agungsm/Documents/dev/open-okr && git status --short`. Stop if anything is modified other than this file and `docs/plans/ai-drafting-quality-benchmark.md`.
2. `git switch feat/0.10.0-designs && git switch -c feat/0.10.0-build`. If the branch exists, `git switch feat/0.10.0-build`.
3. `git config user.name` and `git config user.email` print the owner's identity. Stop if either is empty or names Claude, Gemini or any AI.
4. `pg_isready -h localhost -p 5432` answers. Stop if not. Do not start Docker.

## Global rules

- **Commits.** `git commit -s` with the configured identity. English message, `<kind>(<scope>): <text>`. No co-author trailer, no "generated with" line, no AI name anywhere. Stage files by path; never `git add -A` or `git add .`.
- **Fixing a red check after the commit.** Fix it, stage by path, `git commit --amend -s --no-edit`. A card stays one commit.
- **Never** push, open a pull request, merge, tag or release.
- **No new dependency**, runtime or dev, in any `package.json` or `pnpm-workspace.yaml`. Font and PDF files vendored as files are not dependencies (S13).
- **No migration and no data change** except: K1 `0172`, K3 data change `0037`, S8 `0173`. No other card adds either. **No METHOD.md edit** except in S18.
- **Never change tests, the test harness (`packages/test-support`), ports or passwords to make something pass locally.** The local Postgres on 5432 accepts any password; a failure that depends on it is reported under "Blocked:", not fixed. Never weaken or delete an existing test. An existing test changes only when the specified behaviour of this card, or of an earlier card on this branch, makes its expected value false, or when the card names it. A change that belongs to an earlier card goes in its own follow-up commit, because pushed commits are never amended. Then change only that expected value, keep every assertion, delete or skip nothing, name each edited test in the commit message under "Updated expectations", and stop that card ("Blocked:") if more than 25 assertions need changing or any change goes beyond an expected value.
- **UI text.** Every string a person sees goes through `t()` with the key in `packages/ui/src/i18n/messages/en.json` and `ms.json`. From S4 on, run `pnpm i18n:sync` after adding English keys. Server text from S6 on goes to `packages/core/src/i18n/messages/`.
- **Changesets.** One per card as the card says, in `.changeset/<card-id>-<slug>.md`, front matter `"@openokr/web": <kind>`. A card marked "empty" runs `pnpm changeset --empty`.
- **Hard rules of `CLAUDE.md`** apply: Operation pipeline for writes, access getter for reads, `packages/method` pure, no vendor SDK outside `packages/adapters`, deterministic path works with AI off.
- **One heavy job at a time.** Never run two Vitest suites, two e2e runs or a build beside a suite. Wait for each to finish.
- **Never run** the full `pnpm test`, `pnpm test:ci` or `pnpm test:e2e` without a file.

### Local check tier (every card)

Run in this order. Each must pass.

```
pnpm --filter <each touched package> typecheck
./node_modules/.bin/biome check <each touched file>
TEST_DB_PORT=5432 pnpm test:changed
```

Then commit, then:

```
TEST_DB_PORT=5432 pnpm check:fast
```

Migration cards also run `TEST_DB_PORT=5432 pnpm --filter @openokr/db test` and `pnpm db:lint`. Cards touching METHOD.md or `packages/method` also run `pnpm method:check`.

### End-to-end, only the spec files a card names

```
lsof -i :3210 -i :3211          # must print nothing; stop if a server is listening
TEST_DB_PORT=5432 pnpm build
TEST_DB_PORT=5432 pnpm test:e2e e2e/<file>.spec.ts
rm -rf .turbo/cache apps/web/.next test-results .playwright-mcp packages/*/.turbo apps/*/.turbo
```

### Generated artifacts

A card that changes the action registry runs `pnpm gen:contract` and `pnpm gen:docs` and commits `contract/openapi.json`, `contract/cli.json`, `contract/mcp.json` and `docs/api/reference.md`. `pnpm check:contract` and `pnpm check:docs` must be green.

### Plan build log

Every card appends `<card id> done` to the Note cell of its row in [release-0.10.0.md](release-0.10.0.md) §9, in the same commit: K cards on row `G4`, S cards on row `L1 to L14`.

### AI calls (S5, S16, S19a to S19i, R1)

- Provider `openrouter`, model `openai/gpt-6-luna`.
- The key is the value of `OPENAI_API_KEY` on line 155 of `/Users/agungsm/Documents/dev/flowyforce/.env`. Read it only inside the command's own environment, never print, log, write, echo or commit it, and never store it in the repo `.env`:

```
OPENOKR_AI_API_KEY="$(sed -n '155p' /Users/agungsm/Documents/dev/flowyforce/.env | cut -d= -f2- | tr -d '"\r')" \
  pnpm <command> --provider openrouter --model openai/gpt-6-luna ...
```

- Stop if line 155 does not start with `OPENAI_API_KEY=` (check with `sed -n '155p' <file> | cut -d= -f1`, which prints the name only).
- Price: `curl -s https://openrouter.ai/api/v1/models | jq '.data[] | select(.id=="openai/gpt-6-luna") | .pricing'`. Stop if the model is not listed.
- Estimate before running: input tokens about (characters of English sent) / 4 plus prompt overhead, output about the same. Write the estimate under the card's "Spend:" line. Stop if the estimate exceeds the card's cap.
- After each run, add the tokens the command printed times the price to "Spend:". Stop before a run that would cross the cap.
- Caps: S5 1 USD. S16 1 USD. S19a to S19i together 10 USD. R1: none granted; ask the human before any live call.

## Migration and data change numbers

| Number | Card | File |
|---|---|---|
| Migration 0172 | K1 | `packages/db/migrations/0172_access_binding_owner_share_tags.sql` |
| Data change 0037 | K3 | `packages/db/src/data-changes/0037_kpi_contexts_and_owner_bindings.ts` |
| Migration 0173 | S8 | `packages/db/migrations/0173_member_language_ten_codes.sql` |

No other number is assigned in 0.10.0. If `ls packages/db/migrations` shows 0172 or 0173 already taken before its card, stop.

## Order

K1, K2, K3, K4, K5, K6, K7, K8, S1, S2, S3, S4, S5, S6, S7, S10, S8, S9, S11a, S11b, S11c, S12, S13, S14, S15, S16, S17, S18, S19a, S19b, S19c, S19d, S19e, S19f, S19g, S19h, S19i, R1.

S18 sits after S17 and before S19, as languages §18 orders it, so the method's new catalogue keys exist before the catalogues are translated.

---

## K1 Owner and share tags on access bindings

- Read: kpi-access §1.1, §2 (KA-D6, KA-D8), §3.2, §3.4, §13 row K1.
- Depends on: "Before the first card".
- Files: `packages/db/migrations/0172_access_binding_owner_share_tags.sql` (new, SQL exactly as §3.2); `packages/db/src/schema/access.ts` (tag enum adds `owner`, `share`); `docs/specification/TECHNICAL-PLAN.md` lines named in §3.4 (66, 69, 160); `docs/specification/DATABASE.md` (160, 401); `packages/core/src/portability/policy.ts:762`; `packages/core/src/people/export.ts:233`.
- Tests first: `packages/db/test/access-binding-tags.test.ts`: a binding with tag `owner` inserts, one with `share` inserts, one with `other` is refused by `access_bindings_tag_check`.
- Steps:
  1. Confirm the constraint name: `psql "postgres://postgres@localhost:5432/<a migrated test db>" -c '\d access_bindings'`, or read `0009_access_model.sql`. Stop if it is not `access_bindings_tag_check`.
  2. Write the migration as §3.2. No `if exists`.
  3. Widen the Drizzle enum.
  4. Apply the §3.4 rows for tags and `kpi_shares` only (TECHNICAL-PLAN 66, 69, 160; DATABASE 160, 401; policy and export reasons with the text in §3.4). Leave §7.2 rows to K8.
- Run: local tier, plus `TEST_DB_PORT=5432 pnpm --filter @openokr/db test` and `pnpm db:lint`.
- Changeset: patch, "Access bindings accept the owner and share tags used by per-KPI access."
- Commit: `feat(db): allow owner and share tags on access bindings (0.10.0 K1)`.
- Done when: the three tag tests pass, `db:lint` is green, `kpi_shares` is untouched in SQL.
- Stop if: the constraint has another name; any shipped migration would need an edit; `kpi_shares` would need a schema change.
- Blocked:
- Done: 356a3628

## K2 KPI context and owner binding

- Read: kpi-access §2 (KA-D1 to KA-D5, KA-D9, KA-D10), §3.1, §4, §5 (rows `ensureKpiContextInTx`, `rebindKpiOwnerInTx`), §6 rows R11, R12, R22, R25, §7.1 rows `kpis.create` and `kpis.update`, §13 row K2.
- Depends on: K1.
- Files: `packages/core/src/kpis/access.ts` (new); `packages/core/src/access/reads.ts` (`kpiContextResolver` in `SUBJECT_RESOLVERS`; comment at 798-803); `packages/core/src/actions/kpis.ts` (`kpis.create` 374-502, `kpis.update` 1125-1310); `packages/core/src/search/subjects.ts:96, 224`; `packages/core/src/embeddings/governing.ts:332-347`.
- Tests first: `packages/core/test/kpi-access-context.test.ts`:
  - create binds `workspace_standard` at 10, the owner at 100 tag `owner`, and Champion and Coach only when `space_id` is null;
  - AC-2, AC-3;
  - resolver returns the workspace context for a straggler and `undefined` for a deleted KPI;
  - two concurrent `ensureKpiContextInTx` calls leave one context;
  - owner change to null removes the `owner` binding only.
- Steps:
  1. Write `ensureKpiContextInTx` and `rebindKpiOwnerInTx` with the signatures in §5.
  2. Add `kpiContextResolver` per §4 table, first row.
  3. `kpis.create`: call `ensureKpiContextInTx` for every KPI; keep agent binding for spaceless KPIs only; set `activity.contextId` for `kpi.created` (R22).
  4. `kpis.update`: `subject: {type: "kpi", id}`; `requires: full` when `ownerMemberId` is given, else edit; call `rebindKpiOwnerInTx`.
  5. R11: `CONTEXT_FOR.kpi = "kpi"`, `contextResourceId: entityId`. R12: `{resourceType: "kpi", resourceId: entityId}`. R25: update the comment text.
- Run: local tier.
- Changeset: minor, "Every new KPI gets its own access context, and changing a KPI's owner needs manage access on it."
- Commit: `feat(kpis): give every KPI an access context and an owner binding (0.10.0 K2)`.
- Done when: all listed tests pass; no KPI code calls `getAccessScoped` with `resourceType: "kpi"`.
- Stop if: `access_contexts_resource_idx` is not unique on the columns `on conflict` needs; the Operation pipeline cannot carry `requires` that depends on input.
- Blocked:
- Done: a9a048ea

## K3 Data change 0037

- Read: kpi-access §3.3, §4 (change 2), §12 AC-26, AC-27, §13 row K3. Read `packages/db/src/data-changes/0009_bind_agents_to_spaceless_items.ts` as the pattern.
- Depends on: K2.
- Files: `packages/db/src/data-changes/0037_kpi_contexts_and_owner_bindings.ts` (new); `packages/db/src/data-changes/registry.ts`.
- Tests first: `packages/db/test/data-change-0037.test.ts`: AC-27 (space KPI and spaceless KPI each get a context, `workspace_standard` at 10, owner at 100 tag `owner`, no new agent binding, search rows and KPI activities re-pointed); AC-26 (second run changes 0 rows); owner that is an agent gets no binding.
- Steps:
  1. `expects` exactly the seven columns in §3.3.
  2. Steps 1 to 6 of §3.3 in order, per workspace, 100 workspaces per batch, cursor the last workspace id.
  3. Every insert guarded by `not exists`. Ids from `newId()` as 0009 does.
  4. Register it after 0036.
- Run: local tier, plus `TEST_DB_PORT=5432 pnpm --filter @openokr/db test`.
- Changeset: patch, "An upgrade gives existing KPIs their access context and owner binding."
- Commit: `feat(db): data change 0037 gives existing KPIs contexts and owner bindings (0.10.0 K3)`.
- Done when: AC-26 and AC-27 pass; no migration names 0037 (§4 says that waits for 0.11.0).
- Stop if: any step needs `packages/core`; any `expects` column has another type.
- Blocked:
- Done: 97a935de

## K4 Read enforcement

- Read: kpi-access §4, §5 (rows `requireKpiAccess`, `visibleKpiIds`, the rule and the case table), §6 every row except R11, R12, R22, R25, §10 rows S-20, S-18, S-19, space home, §13 row K4.
- Depends on: K3.
- Files: `packages/core/src/kpis/access.ts`; `packages/core/src/actions/kpis.ts` (grid 732, list 946, recoveryBoard 1709, tree 2040, spaceTrees 2130, detail 2228, recoveryDraft 2493); `actions/rhythm-assists.ts:498`; `actions/kpi-assist.ts:80`; `exports/lists.ts:111`; `copilot/read-tools.ts`; `copilot/fast-path.ts:80`; `api/mcp/research.ts:137`; `kpis/linked.ts:47`; `actions/goals.ts:2348, 2935`; `webhooks/deliver.ts:291`; `nudges/sweep.ts:100-125`; screens `apps/web/app/kpis/page.tsx`, `kpis/trees/page.tsx`, `kpis/recovery/page.tsx`, `apps/web/app/spaces/[id]` KPI section. All under `packages/core/src` unless a path starts with `apps/`.
- Tests first:
  - `packages/core/test/kpi-read-access.test.ts`: AC-11, AC-12, AC-15 to AC-25, AC-28, AC-31; the §5 straggler test (a Viewer refused `edit` on a straggler through `requireKpiAccess`).
  - `e2e/s20d-kpi-guest-access.spec.ts`: one guest spec covering AC-11 and AC-17.
- Steps:
  1. Write `requireKpiAccess` and `visibleKpiIds` per §5 and the §4 straggler rule.
  2. Apply "Filter" or "Single" per §6 to R1 to R10, R13 to R19. R20, R21, R23, R24 need no code; confirm with their tests.
  3. R15: add `memberId` to `readLinkableKpi` and call `requireKpiAccess` at view.
  4. R4: an orphan node carries a flag the screen renders as "Parent not visible".
  5. Screen empty states per §10 with new keys in `en.json` and `ms.json`.
  6. Update existing tests that asserted "every KPI" for a guest; name each in the commit body.
- Run: local tier; e2e `e2e/s20d-kpi-guest-access.spec.ts`.
- Changeset: minor, "A guest sees only the KPIs shared with them, on every screen, search, export, copilot and MCP path."
- Commit: `feat(kpis): enforce per-KPI read access (0.10.0 K4)`.
- Done when: listed tests pass; AC-22 shows a Viewer still lists every KPI.
- Stop if: a read path not in §6 returns KPI titles to a guest; `visibleKpiIds` needs more than two statements.
- Blocked:
- Done: 63525564

## K5 Write enforcement

- Read: kpi-access §2 (KA-D17), §5 (`requireKpiRole`), §7.1 every row, §13 row K5.
- Depends on: K4.
- Files: `packages/core/src/kpis/access.ts`; `packages/core/src/actions/kpis.ts` (record 514, deleteRecord 646, setFormula 1007, update 1125, createTree 1383, launchRecovery 1439, recordResponse 1527).
- Tests first: `packages/core/test/kpi-write-access.test.ts`: AC-9, AC-10, AC-23; `setFormula` refused when a referenced KPI is hidden; `update` with a hidden `parentKpiId` is not-found.
- Steps:
  1. Write `requireKpiRole` per §5.
  2. Apply the "Change" column of §7.1 row by row. "Subject" means `subject: {type: "kpi", id: input.kpiId}`.
  3. `kpis.deleteRecord` takes no subject (§7.1, KA-D17).
- Run: local tier.
- Changeset: minor, "Recording on a KPI follows access on that KPI; deleting readings and recovery actions still need the workspace role."
- Commit: `feat(kpis): enforce per-KPI write access (0.10.0 K5)`.
- Done when: listed tests pass; `kpi-delete-record.test.ts` and `kpi-responses.test.ts` still pass unchanged.
- Stop if: an existing test outside this design's acceptance criteria starts failing.
- Blocked:
- Done: fdf06957

## K6 Sharing actions

- Read: kpi-access §2 (KA-D6, KA-D7, KA-D12, KA-D13, KA-D16), §5 (`setKpiShareInTx`, `removeKpiShareInTx`, case table), §7.2 (rows `kpis.share`, `kpis.unshare`, `kpis.shares`, handler steps, contract list), §9, §13 row K6.
- Depends on: K5.
- Files: `packages/core/src/kpis/access.ts`; `packages/core/src/actions/kpis.ts`; `packages/core/src/actions/registry.ts`; `packages/core/src/activities/catalogue.ts` (`kpi.shared`, `kpi.unshared`); `packages/core/src/api/mcp/toolset-data.ts` (`kpis.shares` in `TOOLSETS.work`); `packages/core/src/people/erase-member.ts`; feed line keys in `en.json`, `ms.json`.
- Tests first: `packages/core/test/kpi-sharing.test.ts`: AC-1, AC-4 to AC-8, AC-29, AC-30, AC-38; audit payloads per §9; `kpis.unshare` of a missing share returns `removed: false` and writes audit.
- Steps:
  1. Write `setKpiShareInTx` and `removeKpiShareInTx` per §5.
  2. Add the three actions with the Zod input, output, level and agent surface of §7.2. `kpis.importShare` waits for K8.
  3. Activity kinds with payload schemas; feed lines in both catalogues.
  4. Erasure soft-deletes `owner` and `share` bindings on `kpi` contexts (KA-D13).
  5. `pnpm gen:contract`, `pnpm gen:docs`.
- Run: local tier; `pnpm check:contract`.
- Generated: `contract/*.json`, `docs/api/reference.md`.
- Changeset: minor, "KPI owners share a KPI with a person at view or edit, and anyone who can view it sees who it is shared with."
- Commit: `feat(kpis): share, unshare and list KPI shares (0.10.0 K6)`.
- Done when: listed tests pass; only `kpis.shares` appears in `contract/mcp.json`.
- Stop if: the Operation pipeline cannot emit `kpi.shared` with subject `kpi`; a notification would be needed.
- Blocked:
- Done: 00423dc5

## K7 S-21 sharing card and goal chip

- Read: kpi-access §6 R16, §10 rows S-21 and Goal page KR chip, §11 Q3, Q4, §13 row K7. UIUX-PLAN §9 gates. Look at `docs/mockups/` for S-21 if present.
- Depends on: K6.
- Files: `apps/web/app/kpis/[id]/page.tsx` and a new card component beside it; goal key result chip under `apps/web/app/goals` (find with `git grep -ln "kpiId" apps/web/app/goals`); `en.json`, `ms.json`.
- Tests first:
  - `apps/web/test/kpi-shared-with-card.test.tsx`: loading, empty ("Not shared with anyone. Members read it through their role."), error with Retry, read-only without `full`; the "Already has edit through their role" hint.
  - `apps/web/test/kpi-hidden-chip.test.tsx`: R16 chip shows "A KPI you cannot see" with no title and no link.
  - `e2e/s21b-kpi-sharing.spec.ts`: owner shares with a Viewer at edit, the Viewer records a reading (AC-9).
- Steps:
  1. Build the card exactly as §10 row S-21, using kit fields from `packages/ui` (`SelectInput`, the owner field's member picker). No raw `<input>` or `<select>`.
  2. Owner field disabled without `full`, with the reason.
  3. Goal chip per R16.
- Run: local tier; e2e `e2e/s21b-kpi-sharing.spec.ts`.
- Changeset: minor, "The KPI page shows who a KPI is shared with and lets its owner share it."
- Commit: `feat(web): KPI sharing card and hidden KPI chip (0.10.0 K7)`.
- Done when: listed tests pass; `pnpm check:boundaries` is green inside `check:fast`.
- Stop if: the member picker cannot be reused without a new component in `packages/ui`.
- Blocked:
- Done: e7b80262

## K8 Import of FlowyTeam KPI shares

- Read: kpi-access §1.3, §2 (KA-D14, KA-D15), §7.2 row `kpis.importShare` and its handler steps, §8 (all), §11 Q7 (answer: refuse) and Q8 (answer: verify), §13 row K8. CLAUDE.md "Importer rules".
- Depends on: K7.
- Files: `packages/core/src/actions/kpis.ts`, `registry.ts`; `packages/importer/src/flowyteam/domains.ts`; `packages/importer/src/flowyteam/mappers/kpi-shares.ts` (new); `packages/importer/src/flowyteam/unread.ts` (entry removed); `packages/importer/src/flowyteam/introspect.ts`; the import command's flag parsing (find with `git grep -n "\"--only\"" packages/importer/src`); `docs/specification/TECHNICAL-PLAN.md` §7.2 rows at 503, 529, 542; `CLAUDE.md` `pnpm import:flowyteam` entry (new domain `kpi-shares`, new flag `--accept-broader-visibility`).
- Tests first: `packages/importer/test/flowyteam-kpi-shares.test.ts`: AC-32 to AC-37; `--write` refused while flagged KPIs exist and `--accept-broader-visibility` is absent (Q7). Update `flowyteam-unread.test.ts` for the removed entry.
- Steps:
  1. Q8 first: read FlowyTeam's own visibility logic, read-only: `grep -rn "indicator_accesses\|IndicatorAccess" /Users/agungsm/Documents/dev/flowyforce --include=*.php | grep -v vendor`. Never open `.env`. If FlowyTeam limits who sees an indicator by anything other than the presence of an `indicator_accesses` row (for example `view_options`), stop and write what you found under "Blocked:".
  2. `kpis.importShare` per §7.2 and the ledger of §8.3.
  3. Domain `kpi-shares` per §8.1; row rules per §8.2; source key per §8.2 (introspect first).
  4. Restriction list per §8.4; dry-run block per §8.5, same labels.
  5. Flag `--accept-broader-visibility`: the check runs before any write, only when the run includes `kpis` or `kpi-shares`.
  6. `pnpm gen:contract`, `pnpm gen:docs` (no MCP change expected).
- Run: local tier, plus the importer suites: `TEST_DB_PORT=5432 pnpm --filter @openokr/importer test`. The test MySQL listens on 53306 with the harness defaults (root, password `mysql`), so no MySQL variable is needed. The suite creates its own databases; never drop another one.
- Generated: `contract/*.json`, `docs/api/reference.md`.
- Changeset: minor, "The FlowyTeam importer carries per-person KPI shares and refuses to write until broader visibility is accepted."
- Commit: `feat(importer): import FlowyTeam KPI shares (0.10.0 K8)`.
- Done when: AC-32 to AC-37 pass; `unread.ts` no longer lists `indicator_accesses`.
- Stop if: Q8 finds a different visibility rule; a source write or lock would be needed; a row cannot map and the §8.2 table names no report line for it.
- Blocked:
- Done: 5557516a

---

## S1 Locale registry and resolution

- Read: languages §1.1, §2 (L-D1 to L-D3, L-D9), §3, §8.1, §8.2, §13 row Drafter, §18 row S1.
- Depends on: K8.
- Files: `packages/formats/src/locales.ts` (new: code, Intl tag, direction, endonym key, font family, `shipped`; `shipped` true for `en` and `ms` only); `packages/formats/src/index.ts`; `packages/core/src/settings/member-language.ts`; `apps/web/lib/locale.ts`; `apps/web/lib/accept-language.ts`; `packages/core/src/mail/words.ts:577` (`mailLocale`); `packages/agents/src/drafter.ts:367`.
- Tests first:
  - `packages/formats/test/locales.test.ts`: ten codes, Intl tags and directions exactly as §3; `ar` resolves to `ar-u-nu-latn`.
  - `apps/web/test/accept-language.test.ts` (extend): every row of §8.2; AC-3 and AC-4 with `zh-Hans` marked shipped inside the test only.
  - `apps/web/test/locale.test.ts` (extend): AC-2 at resolver level (instance step present; unknown stored value skipped).
- Steps:
  1. Write the registry. No messages in it. `packages/formats` stays pure.
  2. `resolveMemberLanguage`: member, workspace, instance, English; returns the registry type.
  3. `visitorLocale` reads the registry (cookie step comes in S9).
  4. `browserLocale` per §8.2.
  5. `mailLocale` and the drafter read the registry. Drafter: `languageName(locale)`, an English name such as "German (Deutsch)".
- Run: local tier.
- Changeset: patch, "Language resolution falls back to the instance default before English."
- Commit: `feat(formats): locale registry and resolution order (0.10.0 S1)`.
- Done when: listed tests pass; `git grep -n '"en" | "ms"' packages apps` shows no new literal.
- Stop if: `packages/formats` purity test fails.
- Blocked:
- Done: 18911079

## S2 Per-locale catalogue loading

- Read: languages §1.2, §2 (L-D5), §4.1, §4.2, §4.3, §18 row S2.
- Depends on: S1.
- Files: `packages/ui/src/i18n/providers/<code>.tsx` (one per locale that has a catalogue: `en`, `ms` now; S19 cards add the rest); `packages/ui/src/i18n/catalogue.ts`; `packages/ui/src/i18n/use-translations.tsx`; `packages/ui/package.json` (`exports` adds `"./catalogues"`); `apps/web/lib/translations.ts` (`getCatalogue`, `server-only`); `apps/web/app/layout.tsx`; the 45 test files that import `CATALOGUES` (find with `git grep -l CATALOGUES -- '*.test.*'`): import line only.
- Tests first: `e2e/s44b-locale-bytes.spec.ts`: AC-6 catalogue part. `/sign-in` with `Accept-Language: en` loads client chunks that contain a known `en` value and no `ms`-only value; the spec prints the transferred catalogue bytes.
- Steps:
  1. Providers per §4.2. The root layout picks one from a map by resolved locale.
  2. `CATALOGUES` leaves the client entry and moves to `@openokr/ui/catalogues`.
  3. `appearance.tsx` reads codes and endonym keys from the registry.
  4. If the bundle spec shows all providers in one chunk, apply the §4.2 fallback (`import()` in a client boundary) and record both byte counts.
  5. Record measured bytes in the `en` and `ms` "After" cells of languages §4.3 (allowed edit).
- Run: local tier; e2e `e2e/s44b-locale-bytes.spec.ts`.
- Changeset: patch, "Browsers download only the catalogue of the language they use."
- Commit: `perf(ui): load one catalogue per locale (0.10.0 S2)`.
- Done when: the spec passes; test files changed only on the import line.
- Stop if: neither mechanism keeps `ms` out of the `en` page; a test needs more than its import line changed.
- Blocked:
- Done: 78084c79

## S3 Message engine and plurals

- Read: languages §1.2 (count variants, apostrophes, literal braces), §2 (L-D6, answer A), §5.1 column A, §5.2, §13 row "The engine", §18 row S3.
- Depends on: S2.
- Files: `packages/formats/src/messages.ts` (new: `translate`, `messageHoles`, plural selection with `Intl.PluralRules`); `packages/ui/src/i18n/catalogue.ts` (uses it; term holes stay in `packages/ui` as a callback; remove the stale comment at 51-54); `en.json`, `ms.json` (count pairs renamed to `<base>.one` / `.other` / `.many` per §5.2); call sites (find with `git grep -nE "t\(\"[^\"]+(One|Other|Many)\"" apps/web packages/ui/src`).
- Tests first:
  - `packages/formats/test/messages.test.ts`: named holes; Arabic six categories; a missing category falls back to `other` and never throws; `What fills {{{placeholder}}}` renders.
  - `packages/ui/test/plural-keys.test.ts`: fails when a key ends in `One`, `Other` or `Many` with a sibling of another of those suffixes; every category carries the same holes as `other` except `{count}` in `one`.
- Steps:
  1. Move the engine. No new dependency (A-2 answered A).
  2. Migrate every count pair and its call sites to `t("x", { count })`.
  3. Keep `join.detail.iAlreadyHaveOne` and other non-count `One` keys as they are.
- Run: local tier.
- Changeset: patch, "Count messages pick their plural form with the language's own rules."
- Commit: `refactor(i18n): plural categories and shared message engine (0.10.0 S3)`.
- Done when: listed tests pass; no `t(... ? "xOne" : "xOther")` pattern remains.
- Stop if: any message would need ICU syntax; a dependency seems needed.
- Blocked:
- Done: 43e2bfe2

## S4 Catalogue gate and sync

- Read: languages §2 (L-D7), §4.1, §6.1, §6.2, §6.4, §18 row S4.
- Depends on: S3.
- Files: `packages/ui/src/i18n/same-as-english.ts` (new; the 148 `SAME_IN_MALAY` entries move with their comment as reason); `packages/ui/src/i18n/pending.json` (new); `packages/ui/src/i18n/glossary/en.json` (new, terms listed in §6.3 row Glossary); `packages/ui/src/i18n/check.ts` (new, pure check functions); `scripts/i18n-check.ts`, `scripts/i18n-sync.ts` (new); root `package.json` scripts `i18n:check`, `i18n:sync`; `scripts/check-fast.ts` (adds `i18n:check`); `packages/ui/test/catalogue.test.tsx` (reads `same-as-english.ts`); `CLAUDE.md` commands list (two entries).
- Tests first: `packages/ui/test/i18n-check.test.ts`: every row of §6.2; AC-7, AC-8, AC-9.
- Steps:
  1. Write the checks of §6.2, both modes (`--release` fails while `pending.json` is not empty).
  2. Sync per §6.1 row "What sync does", for the locales in the registry that have a catalogue file.
  3. Add `i18n:check` to `check:fast`.
- Run: local tier.
- Changeset: empty.
- Commit: `chore(i18n): catalogue gate, sync command and English-match ledger (0.10.0 S4)`.
- Done when: AC-7 to AC-9 pass; `pnpm i18n:check` is green on the current tree.
- Stop if: the 148 entries cannot all be carried over with a reason.
- Blocked:
- Done: 98ee259b

## S5 Translate command

- Read: languages §2 (L-D7), §6.1, §6.3, §16 A-3 (provider for this release: OpenRouter, see "AI calls"), §18 row S5.
- Depends on: S4.
- Files: `packages/agents/src/bin/i18n-translate.ts` (new); a capability or module beside it for batching, masking and validation; `packages/agents/package.json` script `i18n:translate`; root `package.json` script `i18n:translate` delegating as `ai:evaluate` does; `CLAUDE.md` commands list.
- Tests first: `packages/agents/test/i18n-translate.test.ts` against the mock provider: AC-10 (a reply that drops a hole token leaves the key in `pending.json` and is reported); masking round trip; length and script checks; batches of at most 100 keys.
- Steps:
  1. Flags `--locale`, `--keys`, `--provider`, `--model`, as §6.1 and `ai:evaluate`.
  2. Provider calls go through `packages/adapters` only.
  3. Output per §6.3 row Output; print tokens per locale.
  4. Live smoke, cap 1 USD: estimate first, then run `--locale ms --keys "<one key prefix with under 20 keys>"` with the key snippet. Revert the resulting catalogue and ledger changes with `git checkout -- packages/ui/src/i18n` before committing.
- Run: local tier.
- Spend:
- Changeset: empty.
- Commit: `feat(agents): i18n translate command (0.10.0 S5)`.
- Done when: AC-10 passes; the live smoke translated at least one key and spent under 1 USD.
- Stop if: the adapter has no OpenRouter driver usable from this command; the estimate exceeds 1 USD.
- Blocked:
- Done: 22fa85a3

## S6 Server catalogue

- Read: languages §1.3, §2 (L-D14, L-D15), §13 (all rows except Account mail, Exports, Minutes PDF), §18 row S6.
- Depends on: S5.
- Files: `packages/core/src/i18n/messages/en.json`, `ms.json` (new); a loader in `packages/core/src/i18n/`; `packages/core/src/mail/words.ts` (191 keys move); `packages/core/src/notifications/templates.ts`, `drain.ts`; `packages/core/src/nudges/message.ts` (fixed words only; method words wait for S18); `packages/core/src/copilot/read-tools.ts:628`; `packages/core/src/channels/template-mappings.ts`; `scripts/i18n-check.ts`, `scripts/i18n-sync.ts` (server catalogue included).
- Tests first: `packages/core/test/server-catalogue.test.ts`: parity through `i18n:check`; AC-26 at unit level (two recipients, `ms` and `en` standing in for `pt` and `it`, one stored row, two renderings); channel template falls back to the workspace language template.
- Steps:
  1. Move the texts; keys keep their meaning.
  2. Render at delivery or read time in the recipient's resolved locale; no schema change.
  3. Invitations and shared channel posts use the workspace language (§13).
- Run: local tier.
- Changeset: patch, "Mail, notifications and chat render in each recipient's language."
- Commit: `feat(core): server catalogue and per-recipient rendering (0.10.0 S6)`.
- Done when: listed tests pass; `packages/core` imports nothing from `packages/ui`.
- Stop if: a notification row would need stored text.
- Blocked:
- Done: e6b38cbc

## S7 Formats sweep

- Read: languages §3 (conventions, number input row), §12 (all), §18 row S7.
- Depends on: S6.
- Files: every display site in §12; `packages/ui/src/lib/format-measure.ts`; `packages/ui/src/fields/number-input.tsx`; machine sites in §12 get a one-line `// machine use:` comment. Find leftovers with `git grep -nE '"en-GB"|"ms-MY"|toLocale(Date|Time)?String\(\)' -- apps/web 'packages/*/src'`.
- Tests first:
  - `packages/ui/test/format-measure.test.ts` (extend): AC-32; `es` and `it` four-digit numbers not grouped.
  - `packages/ui/test/number-fields.test.tsx` (extend): AC-31 (German message for "1.234"; "1234,5" reads 1234.5; "١٢٣٤" reads 1234).
  - `apps/web/test/formats-sweep.test.ts`: the grep above fails outside the allow-list.
- Steps:
  1. Display sites take the Intl tag from the registry.
  2. `formatMeasure` takes the locale explicitly.
  3. Number input normalisation and ambiguity error per §3; the message is a catalogue key.
  4. `admin/ai/governance.tsx` labels and `admin/channels/page.tsx` "never" go to the catalogue.
- Run: local tier.
- Changeset: patch, "Dates, times and numbers follow the reader's language everywhere."
- Commit: `feat(web): locale-aware dates and numbers (0.10.0 S7)`.
- Done when: listed tests pass; `agents/src/evaluation/run.ts:245` stays `en-GB` with a comment.
- Stop if: a hydration mismatch appears that the explicit locale does not remove.
- Blocked:
- Done: afcc3acf

## S10 Right-to-left foundations

- Read: languages §1.5, §2 (L-D11), §9 (all), §18 row S10.
- Depends on: S7.
- Files: `apps/web/app/layout.tsx` (`dir`, Base UI `DirectionProvider`); `scripts/check-direction.ts` and `scripts/direction-debt.json` (new); `scripts/check-fast.ts`; root `package.json` script `check:direction`; `packages/core/src/mail/render.ts:465`; `packages/ui/src` `TextInput`, `TextArea`, TipTap editor (`textDirection: 'auto'`); pseudo-rtl catalogue in `@openokr/ui/catalogues`; `docs/specification/UIUX-PLAN.md:393`; `CLAUDE.md` commands list.
- Tests first: `apps/web/test/check-direction.test.ts`: AC-17 (a new `ml-2` fails naming file and line; a debt entry passes; a `direction-neutral:` comment passes); `packages/core/test/email-render.test.ts` (extend): AC-19; `packages/ui/test/fields.test.tsx` (extend): AC-18 field part (`dir="auto"`); rich text: if TipTap writes `dir` into JSON, a validator test accepts it.
- Steps:
  1. Root `dir` from the registry; wrap in `DirectionProvider`.
  2. Direction check per §9 row "Lint gate"; the debt list holds today's sites and may only shrink.
  3. Mail `lang` and `dir`; cells `text-align: start`.
  4. `dir="auto"` on user text fields and the editor; `dir="ltr"` islands per §9.
  5. Replace UIUX-PLAN.md:393 with a line stating Arabic is right to left and logical properties are required (cite languages §9).
  6. Update the five expectations the new `dir` makes false, and nothing else in those files: `packages/core/test/email-mails.test.ts` (4 tests: the invitation, the confirmation mail, the password notice, the change of sign-in email) and `apps/web/test/account-mail.test.ts` (1 test: the password reset mail). Each expects `<html lang="ms">` and now expects `<html lang="ms" dir="ltr">`. Name the five in the commit message under "Updated expectations".
- Run: local tier.
- Changeset: patch, "The layout supports right-to-left languages."
- Commit: `feat(web): right-to-left foundations and direction check (0.10.0 S10)`.
- Done when: listed tests pass, including the five updated mail expectations; `pnpm check:direction` is green with the debt list.
- Stop if: the rich-text validator change would need a schema or data change.
- Blocked:
- Done: 0bde36d5 (machine-only: roles.test.ts changed-password)

## S8 Schema and contract for ten codes

- Read: languages §1.1, §2 (L-D8, L-D9, L-D10), §7.1, §7.2, §7.3, §7.4 (A-1 answered A), §17 AC-11 to AC-14, §18 row S8.
- Depends on: S10.
- Files: `packages/db/migrations/0173_member_language_ten_codes.sql` (SQL exactly as §7.1); `packages/db/src/schema/workspaces.ts:113`; `packages/core/src/actions/people.ts:201, 1097`; `packages/core/src/settings/registry.ts:150`; `packages/core/src/actions/settings.ts:295`; the workspace language picker (`apps/web/app/admin/general/general-settings-form.tsx`) for "Not available: xx"; `docs/specification/TECHNICAL-PLAN.md` and `docs/specification/DATABASE.md` member `language` lines (find with `git grep -n "language?" docs/specification/TECHNICAL-PLAN.md docs/specification/DATABASE.md`) to name the ten codes.
- Tests first: `packages/db/test/member-language-codes.test.ts`: AC-11; `packages/core/test/language-settings.test.ts`: AC-13 (resolution skips `xx`, saving another field keeps it), new writes refused outside shipped codes; AC-14 through `pnpm check:contract`.
- Steps:
  1. Migration as §7.1, no `if exists`.
  2. Drizzle enum from the registry's ten codes.
  3. Action enums and settings refinement per §7.2.
  4. Picker state "Not available: `xx`".
  5. `pnpm gen:contract`, `pnpm gen:docs`.
  6. AC-12 (mixed-version) runs in R1, which needs a full 0.9.x build.
- Run: local tier, plus `TEST_DB_PORT=5432 pnpm --filter @openokr/db test` and `pnpm db:lint`.
- Generated: `contract/*.json`, `docs/api/reference.md`.
- Changeset: minor, "Members and workspaces can store any of the ten interface languages."
- Commit: `feat(db): member language accepts the ten locale codes (0.10.0 S8)`.
- Done when: AC-11, AC-13, AC-14 pass.
- Stop if: `0173` is taken; the constraint is not named `workspace_members_language_known`; a data change seems needed.
- Blocked:
- Done: b64c0ea6 (machine-only: roles.test.ts changed-password; deferred: pooling-spike.test.ts and other unresolved test:changed failures, local continuation approved)

## S9 Pickers and signed-out switcher

- Read: languages §1.1, §2 (L-D3, L-D20), §8.1, §8.3, §16 A-9 (answer: docs), §17 AC-1, AC-5, §18 row S9. UIUX-PLAN §8.
- Depends on: S8.
- Files: `apps/web/lib/appearance.tsx` (select with "Follow workspace"); `apps/web/app/admin/general/general-settings-form.tsx` (workspace picker, instance picker on self-hosted, clear-to-inherit); `apps/web/app/operator/instance/` (cloud operator instance picker); sign-in page under `apps/web/app/(auth)/sign-in/` (switcher); a server action setting `openokr_locale` as `apps/web/app/workspace-switcher.tsx:46` does; `apps/web/lib/locale.ts` (cookie step); `docs/admin/security.md` (list the three cookies).
- Tests first: `apps/web/test/locale.test.ts` (extend): cookie step, invalid cookie ignored, AC-1 with `de` marked shipped in the test only; `e2e/s35h-visitor-language.spec.ts` (extend): AC-5 with `ms` and `en`; `e2e/s03d-language-follow-workspace.spec.ts`: a member chooses Malay, then "Follow workspace".
- Steps:
  1. Pickers list shipped locales from the registry by endonym key.
  2. Cookie attributes exactly as §8.3.
  3. Instance picker uses the existing permission boundary for General (self-hosted) and the operator Instance screen (cloud).
- Run: local tier; e2e `e2e/s35h-visitor-language.spec.ts` then `e2e/s03d-language-follow-workspace.spec.ts`.
- Changeset: minor, "Members can follow the workspace language, admins set the instance language, and visitors choose a language before signing in."
- Commit: `feat(web): language pickers and signed-out switcher (0.10.0 S9)`.
- Done when: listed tests pass.
- Stop if: the operator Instance screen has no place for a setting without a new screen.
- Blocked:
- Done: 0ac0204c (machine-only: roles.test.ts changed-password; deferred: inherited test:changed failures carried from S8)

## S11a RTL sweep, packages/ui

- Read: languages §1.5 inventory, §9 rows Classes, Inline styles and CSS, Icons, §18 row S11a.
- Depends on: S9.
- Files: entries of `scripts/direction-debt.json` under `packages/ui/src` (list with `jq` or `pnpm check:direction`).
- Tests first: the debt list entries for `packages/ui/src` are removed first, so `pnpm check:direction` fails; then fix.
- Steps:
  1. Physical to logical per §9 row Classes; `left-1/2 -translate-x-1/2` centring stays with a `direction-neutral:` comment.
  2. Inline styles and `tokens.css` lines to `inset-inline-*`, `margin-inline-*`.
  3. Directional icons get `rtl:-scale-x-100`; others do not.
  4. Capture pseudo-rtl screenshots of the kit's test page if one exists; otherwise note "none" in the commit body.
- Run: local tier; `pnpm check:direction`.
- Changeset: patch, "Shared components lay out correctly right to left."
- Commit: `refactor(ui): logical direction in shared components (0.10.0 S11a)`.
- Done when: no debt entry under `packages/ui/src` remains.
- Stop if: a change alters left-to-right rendering in an existing test.
- Blocked:
- Done: fd29619a (machine-only: roles.test.ts changed-password; deferred: inherited test:changed failures carried from S8)

## S11b RTL sweep, apps/web/app A to K

- Read: as S11a.
- Depends on: S11a.
- Files: debt entries under `apps/web/app/` whose first path segment, ignoring `(` and `)`, starts with `a` to `k` (includes `(auth)`, `(home)`, `account`, `activity`, `admin`, `agent-*`, `board`, `check-in`, `copilot`, `cycle`, `dev`, `documents`, `fonts`, `globals.css`, `goal-nodes.ts`, `goals`, `inbox`, `initiatives`, `join`, `key-results`, `kpis`).
- Tests first: remove those debt entries; `pnpm check:direction` fails.
- Steps: as S11a steps 1 to 3.
- Run: local tier; `pnpm check:direction`.
- Changeset: patch, "Screens A to K lay out correctly right to left."
- Commit: `refactor(web): logical direction in screens A to K (0.10.0 S11b)`.
- Done when: no debt entry in that range remains.
- Stop if: as S11a.
- Blocked:
- Done: cf9f39ff (machine-only: roles.test.ts changed-password; deferred: inherited test:changed failures carried from S8)

## S11c RTL sweep, apps/web/app L to Z, apps/web/lib and the rest

- Read: as S11a.
- Depends on: S11b.
- Files: every remaining debt entry, including `apps/web/lib`, `apps/web/hooks`, `agent-face.css`.
- Tests first: empty `scripts/direction-debt.json`; `pnpm check:direction` fails.
- Steps: as S11a steps 1 to 3. The debt list ends empty.
- Run: local tier; `pnpm check:direction`.
- Changeset: patch, "Every screen lays out correctly right to left."
- Commit: `refactor(web): logical direction in remaining screens (0.10.0 S11c)`.
- Done when: the debt list is empty and the check is green.
- Stop if: as S11a.
- Blocked:
- Done: b8073911 (machine-only: roles.test.ts changed-password; deferred: inherited test:changed failures carried from S8)

## S12 Arrow keys and charts

- Read: languages §1.5 (board keys, arrow-key files), §9 rows Arrow keys and Charts, §17 AC-16, §18 row S12.
- Depends on: S11c.
- Files: `apps/web/app/board/board-keys.ts`, `goals/okr-diagram.tsx`, `kpis/grid.tsx`, `admin/agents/agent-tabs.tsx`, `admin/ai/provider-tabs.tsx`, `apps/web/lib/product-tour.tsx`; progress bars and time axes (find with `git grep -lnE "progress|axis" packages/ui/src apps/web/app -- '*.tsx' | xargs grep -lE "width:|translateX|left"`).
- Tests first: `apps/web/test/board-keys.test.ts` (extend or create): AC-16; a chart unit test asserting a progress bar fills from inline start in `rtl` and a time axis reverses while a value axis does not.
- Steps:
  1. Each arrow-key handler takes the direction; in `rtl` `ArrowLeft` is next in reading order.
  2. Progress bars and time axes per §9 row Charts.
- Run: local tier.
- Changeset: patch, "Arrow keys and charts follow the reading direction."
- Commit: `feat(web): direction-aware arrow keys and charts (0.10.0 S12)`.
- Done when: listed tests pass; `board-live.test.tsx` and `product-tour.test.tsx` still pass.
- Stop if: an existing keyboard test would need its left-to-right expectation changed.
- Blocked:
- Done: c9016fd3 (machine-only: roles.test.ts changed-password; deferred: inherited test:changed failures carried from S8)

## S13 Fonts

- Read: languages §1.5 (font, air-gap check), §2 (L-D12), §10 (all), §16 A-10 (answer: system), §17 AC-6, AC-30, §18 row S13.
- Depends on: S12.
- Files: `apps/web/public/fonts/noto-sans-sc/` (97 Han slices and `OFL.txt`); `apps/web/public/fonts/noto-sans-arabic/` (Arabic slice and `OFL.txt`); PDF fonts `NotoSansSC-Regular.otf` and unhinted `NotoSansArabic-Regular.ttf` in a folder under `apps/web` that the PDF route can read (record the path in the README); CSS with `@font-face` and `unicode-range`; `apps/web/app/layout.tsx` (stack; SC stylesheet only for `zh-Hans`); `apps/web/app/fonts/README.md` (source, version, SHA-256 per file); `scripts/check-air-gap.ts:88`; `docs/runbooks/air-gap.md:70`.
- Tests first: `e2e/font-self-hosting.spec.ts` (extend) or `e2e/s44b-locale-bytes.spec.ts` (extend): AC-6 font part (an `en` page downloads no Noto file); a unit test for the air-gap check: AC-30.
- Steps:
  1. In the scratchpad, `npm pack @fontsource-variable/noto-sans-sc@5.3.1` and `npm pack @fontsource-variable/noto-sans-arabic@5.3.0`; copy only the files §10.1 names. Never add them to any `package.json`.
  2. Download the two PDF font files from the URLs in §10.1 with `curl`; record SHA-256.
  3. CSS and stack per §10.2. No preload.
  4. Air-gap check per §10.2 row Air gap; runbook row names both checks.
  5. Measure the image: `docker image inspect` only if Docker (Colima) is already running; otherwise write "not measured, R1" in the commit body. Record numbers in languages §10.3 (allowed edit).
- Run: local tier; `pnpm check:air-gap`; e2e on the spec changed.
- Changeset: patch, "Arabic and Simplified Chinese text render with bundled fonts, offline."
- Commit: `feat(web): bundle Noto Sans Arabic and Noto Sans SC (0.10.0 S13)`.
- Done when: AC-6 font part and AC-30 pass; README lists every file with its checksum.
- Stop if: a file's licence is not OFL 1.1; a download fails; slicing seems needed.
- Blocked:
- Done: f2a21045, e2bc9ace (deferred: test:changed interrupted by restart; local PostgreSQL could not locate a valid checkpoint)

## S14 Minutes PDF

- Read: languages §1.3 row Minutes PDF, §2 (L-D13), §10.1 (PDF rows), §10.2 row PDF, §11 (all), §13 row Minutes PDF, §16 A-12 (answer: print), §17 AC-28, §18 row S14.
- Depends on: S13.
- Files: `apps/web/app/session/[id]/minutes/pdf/render.tsx`; `apps/web/app/session/[id]/minutes/pdf/route.ts`; the minutes print view and its PDF button (find with `git grep -ln "minutes/pdf" apps/web/app`); PDF label keys in the server catalogue.
- Tests first: `apps/web/test/minutes-pdf.test.ts`: footer and labels from the server catalogue in the requester's locale; dates and numbers in that locale; `direction: "rtl"` set for `ar`.
- Steps:
  1. Run the §11.2 checks on a scratch script with the repo's `@react-pdf/renderer` 4.9.0. If `pdftotext` is not installed, stop and ask; do not install software.
  2. If 4.9.0 passes all three: keep `@react-pdf/renderer` for every locale, register fonts with `Font.register`, the Han hyphenation callback, and `direction: "rtl"` for `ar`.
  3. If only a newer 4.x passes: stop. A version bump needs the human.
  4. If all fail: A-12 print. For `ar` the PDF button opens the print view; other locales keep the PDF with registered fonts.
  5. Labels, footer, dates and numbers from the requester's locale.
- Run: local tier.
- Changeset: patch, "The minutes PDF is in the requester's language, including Chinese and Arabic."
- Commit: `feat(web): localised minutes PDF (0.10.0 S14)`.
- Done when: listed tests pass; the §11.2 result is written in the commit body.
- Stop if: step 3 applies; `pdftotext` is missing.
- Blocked:
- Done: e65f3f5f (machine-only: roles.test.ts changed-password; deferred: prior-card checks recorded in Step 0)

## S15 Exports

- Read: languages §1.3 rows List exports and Queued exports, §2 (L-D16), §13 row Exports, §16 A-11 (answer: headers), §17 AC-27, §18 row S15.
- Depends on: S14.
- Files: `packages/core/src/exports/lists.ts`; `packages/core/src/exports/worker.ts`; header keys in `packages/core/src/i18n/messages/en.json` and `ms.json`.
- Tests first: `packages/core/test/export-headers.test.ts`: AC-27 with `ms` standing in for `es` (headers translated inline and queued; health values are keys; dates ISO; numbers with `.`).
- Steps:
  1. Headers from the server catalogue in the requester's locale.
  2. Queued exports resolve the locale from `requested_by_id` at build time. No schema change.
- Run: local tier.
- Changeset: patch, "Export headers are in the requester's language; values stay machine-readable."
- Commit: `feat(core): localised export headers (0.10.0 S15)`.
- Done when: listed tests pass.
- Stop if: a stored column would be needed for the locale.
- Blocked:
- Done: 5476f5c4 (machine-only: roles.test.ts changed-password; deferred: prior-card checks recorded in Step 0)

## S16 AI locale

- Read: languages §1.3 rows Copilot, Other AI capabilities, Evaluation, §2 (L-D19), §15 (all), §17 AC-25, §18 row S16. `docs/design/ai-evaluation.md`.
- Depends on: S15.
- Files: `packages/agents/src/drafter.ts`; the 21 text-writing capabilities listed in §15 row Other capabilities (the list is verified; the rows below it say which locale each uses, that `proposeObjectives` is wired nowhere, and that the `filter-assist.ts` fallback string moves to a catalogue key); `packages/agents/src/evaluation/sets.ts` (one fixture per locale per text-writing capability); `packages/core/src/copilot/answer.ts:278`.
- Tests first: `packages/agents/test/evaluation.test.ts` (extend): each text-writing capability's prompt names the locale's language from the registry; the mock reply passes the script check (Han for `zh-Hans`, Arabic for `ar`); AC-25 mock part ("reply in English" switches the language).
- Steps:
  1. Add `locale` to the context of every text-writing capability; key-returning capabilities stay as they are.
  2. Prompts name the language with `languageName(locale)`.
  3. AI-off path renders from catalogues; no provider call.
  4. Live check, cap 1 USD: estimate, then `pnpm ai:evaluate --provider openrouter --model openai/gpt-6-luna` once with the key snippet. Record the cost.
- Run: local tier; `pnpm ai:evaluate` (mock).
- Spend:
- Changeset: patch, "The copilot and every writing assist answer in the member's language."
- Commit: `feat(agents): pass the member locale to text-writing capabilities (0.10.0 S16)`.
- Done when: listed tests pass; the live run finished under 1 USD.
- Stop if: the estimate exceeds 1 USD.
- Blocked:
- Done: 071b7f3e (deferred: ai:evaluate live; machine-only: roles.test.ts changed-password)

## S17 Account mail

- Read: languages §1.3 row Account mail, §2 (L-D17), §13 row Account mail, §16 A-8 (answer: request), §17 AC-33, §18 row S17.
- Depends on: S16.
- Files: `packages/core/src/mail/account.ts`; `apps/web/lib/account-mail.ts`.
- Tests first: `packages/core/test/email-mails.test.ts` (extend): AC-33 with `ms` standing in for `de` (a reset requested from the `ms` sign-in page is mailed in Malay); no request gives the instance language.
- Steps:
  1. Pass the request's resolved visitor locale to account mail; fall back to the instance language.
- Run: local tier.
- Changeset: patch, "Account mail uses the language of the page it was requested from."
- Commit: `feat(core): account mail in the request's language (0.10.0 S17)`.
- Done when: listed tests pass.
- Stop if: a new account-level column seems needed.
- Blocked:
- Done: d61f5a27 (machine-only: roles.test.ts changed-password)

## S18 Method: text that is not English

- Read: languages §1.4, §2 (L-D18), §14 (all; A-4 answered A script, A-5 skip, A-6 yes, A-7 yes, A-13 approved), §17 AC-21 to AC-24, §18 row S18. METHOD.md §4.
- Depends on: S17.
- Files: `docs/specification/METHOD.md:414` (the paragraph starting "**What word lists can and cannot do.**"); `packages/method/src/quality.ts`; a script detector in `packages/method/src/` (pure, Unicode script properties); `scripts/method-check.ts` (new comparison for the method text keys); `en.json`, `ms.json` keys `method.rule.<id>.title`, `method.rule.<id>.condition.<n>.prompt`, `method.coach.<rule>`; `apps/web/app/cycle/rule-verdict.tsx:137` and coach surfaces read those keys; `packages/core/src/nudges/message.ts` headline and coach line from the keys.
- Tests first: `packages/method/test/non-english-text.test.ts`: AC-21, AC-22, AC-23; `apps/web/test/rule-verdict.test.tsx` (extend or create): AC-24 with `ms` standing in for `fr`.
- Steps:
  1. Replace the METHOD.md:414 paragraph with exactly this text, verbatim:

> **What word lists can and cannot do.** OBJ-1 and KR-5 match words from the §4 lists. KR-2 and the digit conditions of OBJ-1, OBJ-2 and KR-5 count digits; Arabic-Indic digits count as digits. A word list will always be behind English, and the checks are measured against published OKRs (`packages/method/test/published-examples.test.ts`). So no word-list check blocks by default. A person decides what blocks, not a word.
>
> **Text that is not English.** Whether a title or key result is English is read from the text, never from the reader's language setting: text whose letters are mostly Han or Arabic is not English. For such text the word-list conditions of OBJ-1 and KR-5 are not evaluated, OBJ-2 does not count words, and the coach says so: "The word checks read English only, so this text was not checked for them." A check not evaluated is left out of the strength score, as a check that is off is. Every other check, and every digit condition, runs as for English text. A check not evaluated never blocks a publish gate.

  2. Script detection: more than half the letters Han or Arabic means not English (§14.2 option A).
  3. Normalise U+0660 to U+0669 and U+06F0 to U+06F9 before digit reads (A-6).
  4. Skip and notice per the new paragraph; excluded from the score denominator; never blocks a gate.
  5. Generate the method text keys from `packages/method` with a one-off script kept in the scratchpad (not committed); `method:check` compares English values with the package.
  6. `pnpm i18n:sync` so the new keys reach every catalogue.
- Run: local tier; `pnpm method:check`; `TEST_DB_PORT=5432 pnpm --filter @openokr/method test`.
- Changeset: minor, "The coach skips English word checks on Chinese and Arabic text, says so, and shows its rules in the reader's language."
- Commit: `feat(method): word checks read English text only (0.10.0 S18)`.
- Done when: AC-21 to AC-24 pass; `pnpm method:check` is green; no threshold or word list changed.
- Stop if: any rule key, threshold or band would change; the conformance suite cannot compare the new keys.
- Blocked:
- Done: 21f2ff0d (machine-only: roles.test.ts changed-password)

---

## S19 cards, shared steps

Every S19 card runs these, with its own `<code>`:

1. Read languages §3 row `<code>`, §4.3, §6.3, §6.4, §18 rows S19a to S19i.
2. Estimate from the characters of English values pending for `<code>` in both catalogues; write it under "Spend:". Stop if the running S19 total plus the estimate exceeds 10 USD.
3. `pnpm i18n:translate --locale <code> --provider openrouter --model openai/gpt-6-luna` with the key snippet. The first run drafts `glossary/<code>.json`.
4. Repeat step 3 only for keys the run rejected, while the cap allows.
5. Add `same-as-english.ts` entries only for endonyms and product names (§6.4).
6. Add `packages/ui/src/i18n/providers/<code>.tsx` (S2 pattern).
7. Set `shipped: true` for `<code>` in `packages/formats/src/locales.ts`.
8. `pnpm i18n:check --release` passes for `<code>` (other locales may still be pending).
9. Add `<code>` to `e2e/s35i-locale-smoke.spec.ts` (created in S19b): sign in as a member with `<code>`, open Home, assert `<html lang>` and one translated string.
10. Record raw and gzip bytes of `<code>.json` in languages §4.3 (allowed edit).
11. Local tier; e2e `e2e/s35i-locale-smoke.spec.ts`.
12. Changeset: minor, "<Language> is available as an interface language." Commit `feat(i18n): add <Language> (0.10.0 S19x)`.

Stop if: a key fails validation three times; the script check fails on more than 1 percent of keys; the cap would be crossed.

## S19a Malay additions

- Depends on: S18. Code `ms`. Skip steps 6, 7, 9 (already shipped). Changeset patch, "Malay covers the new interface text."
- Spend:
- Blocked:
- Done: b670f401 (machine-only: roles.test.ts changed-password)

## S19b Simplified Chinese

- Depends on: S19a. Code `zh-Hans`. Create `e2e/s35i-locale-smoke.spec.ts` with `ms` and `zh-Hans`. Also AC-29: record the Noto Sans SC slices downloaded on Home, OKRs and Check-in in languages §10.3.
- Spend:
- Blocked:
- Done: c1cd1c47 (machine-only: roles.test.ts changed-password)

## S19c Spanish

- Depends on: S19b. Code `es`.
- Spend:
- Blocked:
- Done: 56411306 (machine-only: roles.test.ts changed-password)

## S19d Portuguese (Brazil)

- Depends on: S19c. Code `pt`.
- Spend:
- Blocked:
- Done: 0a4f9d03 (machine-only: roles.test.ts changed-password)

## S19e Arabic

- Depends on: S19d. Code `ar`. Also AC-15 in `e2e/s35i-locale-smoke.spec.ts` (`lang="ar" dir="rtl"`, sidebar on the right, a mirrored icon, a progress bar filling from the right). AC-20: add the `ar` pass to `e2e/s43-accessibility.spec.ts` and `e2e/s43b-accessibility-keyboard.spec.ts` per languages §9 row Accessibility, and run both files.
- Spend:
- Blocked:
- Done: 09adacaf (machine-only: roles.test.ts changed-password)

## S19f German

- Depends on: S19e. Code `de`.
- Spend: US$0.0829 (S19 running total US$0.4077)
- Blocked:
- Done: 8a009674 (machine-only: roles.test.ts changed-password)

## S19g French

- Depends on: S19f. Code `fr`.
- Spend: US$0.0848 (S19 running total US$0.4925)
- Blocked:
- Done: 6fbba1ea (machine-only: roles.test.ts changed-password)

## S19h Italian

- Depends on: S19g. Code `it`.
- Spend: US$0.0847 (S19 running total US$0.5772)
- Blocked:
- Done: 8208530d (machine-only: roles.test.ts changed-password)

## S19i Indonesian

- Depends on: S19h. Code `id`. After this card `pnpm i18n:check --release` must pass for every locale; stop if it does not.
- Spend: US$0.0786 (S19 running total US$0.6556)
- Blocked:
- Done: 06b40b1c (machine-only: roles.test.ts changed-password)

---

## R1 Release checks

- Read: languages §18 row S20, §9 rows Accessibility and Visual review; kpi-access §12; release plan §5 (every row) and §8 step 4.
- Depends on: S19i.
- Files: `docs/audits/release-0.10.0-checks.md` (new: one section per plan §5 row with what ran and its result); languages §4.3 and §10.3 cells still empty; plan §9 build log; this file.
- Steps:
  1. KPI access: list every kpi-access AC-1 to AC-39 with the test that covers it. Run the importer suites (K8 command). Do not connect to any production FlowyTeam database.
  2. Settings and upgrade, AC-12: build the newest `v0.9.*` tag in a `git worktree` under the scratchpad, migrate one database with this branch, run the §7.4 option A steps against both builds. Stop if no `v0.9.*` tag exists.
  3. Catalogue and formats: `pnpm i18n:check --release`; the formats sweep test.
  4. Visual and offline: screenshots of every screen in `ar` at 1440 and 390 widths into the scratchpad, listed in the audit file; offline Chinese and Arabic print and PDF sample; `pnpm check:air-gap`; image size with `docker image inspect` if Colima runs, else record "not measured".
  5. Translation and delivery: two members with different locales across copilot, agents, mail, notifications, chat, exports and PDFs on the lean dev server (`./lean-dev.sh start`); provider-off path with AI disabled. Live per-locale `pnpm ai:evaluate` only after the human grants a cap.
  6. Update the plan §9 build log: rows `G4` and `L1 to L14` status "done, waiting for review".
  7. Local tier.
  8. Commit the audit file, the build log, the §4.3 and §10.3 cells and this file: `docs(release-0.10.0): record release checks (0.10.0 R1)`. Changeset: empty.
  9. Clear build caches: `rm -rf .turbo/cache apps/web/.next test-results .playwright-mcp packages/*/.turbo apps/*/.turbo`, then `git worktree remove` the 0.9 worktree, then `df -h /`. Write the free space on the "Done:" line beside the hash.
- Done when: every plan §5 row has a result; no push was made.
- Stop if: any acceptance criterion fails; AC-12 shows a data loss or an unhandled error on the old build.
- Blocked:
- Done: 397dda39, free disk 312 GiB
