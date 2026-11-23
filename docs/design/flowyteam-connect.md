# FlowyTeam connect: import from FlowyTeam in the browser

Status: **approved by Agung on 23 November 2026, Q1 to Q9 as recommended.** One-way for now: OKRGoal reads FlowyTeam and nothing flows back (owner decision the same day). It adds a subsystem, a table and a new way for data to enter a workspace, so it was designed first (CLAUDE.md, change loop).

Today a FlowyTeam import needs the FlowyTeam MySQL address and a terminal (`pnpm import:flowyteam`). A customer of the managed cloud has neither: the FlowyTeam database holds every company, so nobody outside FlowyTeam's own operators can be given it. This design lets a workspace admin connect FlowyTeam from Admin > Import, approve the connection in FlowyTeam, preview, import and invite people, with no database address and no terminal.

Two repositories change. This document is the authority for the OpenOKR side and the request to the FlowyTeam side (section 6), which the FlowyTeam team designs in its own repository.

Prototype of both sides, clickable: [flowyteam-connect-prototype.html](flowyteam-connect-prototype.html). Reference, not authority, like the mockups.

## 0. What exists today

### OpenOKR

| Piece | Where | Today |
|---|---|---|
| The source | `packages/importer/src/flowyteam/source.ts:31` | `interface Source { query<T>(sql, values) }` over a read-only MySQL session with a statement allow list (`assertRead`, `:132`) |
| The queries | `packages/importer/src/flowyteam/mappers/*.ts` | 46 `source.query` calls with SQL written inline, 18 of them with a join. 28 bind `options.companyId` directly; the rest bind ids read earlier in the same run |
| The runner and report | `packages/importer/src/flowyteam/run.ts`, `report.ts` | Dry run equals write, idempotent on `(workspace_id, legacy_type, legacy_id)`, one company per workspace (`companyAlreadyImported`, `run.ts:226`) |
| The boundary | TECHNICAL-PLAN §1, line 31 and 37 | `apps/web` may not depend on `packages/importer`, so the MySQL client stays out of the web application. The spreadsheet engine was moved to `packages/core/src/imports` for the same reason |
| Run bookkeeping | `packages/core/src/actions/imports.ts:55`, `:121`, `:206` | `imports.startRun`, `imports.finishRun`, `imports.listRuns` |
| Sealed secrets | `packages/core/src/secrets/key-ring.ts`, `packages/core/src/ai/credentials.ts` | Envelope encryption for stored credentials |
| Background work | `apps/web/lib/scheduler.ts`, the jobs port | pg-boss through `packages/adapters`, a job expires 15 minutes after it starts ([worker-deployment](worker-deployment.md) §0) |
| The screen | `apps/web/app/admin/imports/page.tsx` | Spreadsheet wizard, recent runs, workspace archive. No FlowyTeam card |

### FlowyTeam (its source, checked on c1be5e4c4)

| Piece | Where | Today |
|---|---|---|
| OAuth 2.0 server | `app/Mcp/CloudConnector/OAuth/OAuthController.php`, `OAuthService.php` | Authorize with a consent page, token exchange, PKCE S256 required for public clients, authorization code lives 10 minutes |
| Clients | `routes/super-admin.php:153-161`, `CimdClientResolver.php` | Confidential clients registered by the super admin (rotate, disable, revoke tokens), and public clients identified by a client metadata document URL with PKCE |
| Scopes | `OAuthDiscovery.php:24` | `flowyteam:access` (every cloud tool, read and write) and `flowyteam:okr` (OKR tools only). No read-only scope |
| Tokens | `OAuthService.php:174` | Bound to one user and that user's `company_id`. No expiry and no refresh token; revocable |
| Cloud MCP tools | `app/Mcp/CloudConnector/Tools`, `routes/api.php:209` | 66 tools shaped for an AI client, 50 rows a page, 60 calls a minute. Nothing for KPIs, KPI values, teams, task comments, checklists, files or key result history |
| Who may approve | `Tools/Objectives/ListObjectivesTool.php:86` | Any user; reads are filtered by `company_id`, not by role |

**Why the MCP tools are not the import channel.** They miss most of what the importer reads, they return fields formatted for a model rather than the source columns the mappers map, and their scope also allows writes. Adding the missing tools would duplicate the importer's reads in a second shape and hand an AI client bulk access to the same data. The OAuth server is reused as it is.

## 1. Scope

| In | Out |
|---|---|
| Connect, preview, import, invite and import again, from S-36 Admin > Import | Updating rows already imported when they change in FlowyTeam later (section 2, Q5) |
| The managed cloud and self-hosted instances that can reach FlowyTeam | An air-gapped instance: the card says it cannot reach FlowyTeam and points to the command line |
| Everything `pnpm import:flowyteam` imports today, with the same report | The tables listed under "What it does not bring across yet" in `docs/import/README.md` |
| The command line keeps working against MySQL, unchanged for its user | Writing anything to FlowyTeam |

## 2. Decisions to approve

| # | Question | Recommendation | Why | Rejected |
|---|---|---|---|---|
| Q1 | How do the 46 reads travel | **A named query catalogue.** Every SQL statement the mappers run gets a stable name and moves into one catalogue. The MySQL source looks the SQL up by name and runs it as today. The HTTP source sends the name and the values; FlowyTeam runs its own vendored copy of the same SQL. FlowyTeam never runs SQL it received | The mappers, the folding, the idempotency and the report stay as they are, so both sources produce the same import. FlowyTeam executes only statements it reviewed and shipped | (a) Table dumps loaded into a staging store: needs a SQL engine in OpenOKR (a new dependency, or staging tables outside the tenant floor), and the 18 joins rewritten. (b) More MCP tools: see section 0 |
| Q2 | Where the FlowyTeam engine lives | **Move the mappers, the runner, the report and the catalogue to `packages/core/src/imports/flowyteam`**, behind the `Source` interface. `packages/importer` keeps the MySQL source and the command line | Same seam as the spreadsheet engine (TECHNICAL-PLAN §1): the web application and the scheduler run the engine without `mysql2` in their graph | A worker process importing `packages/importer`: it puts the MySQL client back in the deployable application |
| Q3 | Where the connection is stored | **A new table `import_connections`** (section 4.2) with row-level security in the same migration, the token sealed with the key ring | A token is a credential: envelope-encrypted, never logged, decrypted server-side only (CLAUDE.md) | Storing it in `workspaces.settings`: settings are not sealed and are exported in archives |
| Q4 | How a run executes | **A background job** through the jobs port, enqueued by an outbox row from `imports.flowyteamRun`; progress per domain through the realtime port. A run longer than the job expiry continues in a follow-up job from the last finished domain | 9,846 rows took minutes against real data; a request cannot hold that. Each domain is already idempotent, so resuming at a domain repeats nothing | Running it in the request |
| Q5 | What "Import new data" means | **Add what is new, change nothing already imported**, which is today's behaviour, said on the card in those words | Updating needs a rule per field for who wins when both sides changed. That is its own design | Two-way or one-way sync |
| Q6 | Invitations | **A last step listing the imported people, filtered to those active in FlowyTeam in the last 90 days, through the existing invitation action.** Nothing is sent before the admin sends it; "Not now" leaves everyone uninvited | An import of 214 people must not email 214 people before the admin has checked the result | Inviting automatically on write |
| Q7 | Files | **One file at a time through a FlowyTeam file endpoint**, streamed into the storage port, with the per-file size limit storage already applies. A file over it is reported by name | Same result as `--files-root` without access to FlowyTeam's disk | Embedding files in query results |
| Q8 | Keeping both catalogues equal | **The catalogue is generated into `contract/flowyteam-queries.json` with a version hash, checked by a drift gate like `check:contract`.** FlowyTeam vendors that file. Each request carries the version; FlowyTeam answers 409 with its own version on a mismatch, and the card says "FlowyTeam needs an update before this import" | A changed query on one side only would import something different from what was reviewed | Version-free requests |
| Q9 | Who may connect | **A workspace member with `full` on imports here, and a company admin in FlowyTeam.** Both conditions are checked on their own side | The token reads a whole company | Any FlowyTeam user |

**As built (C4).**

| Decision | Built |
|---|---|
| Q4 | The outbox topic `imports.flowyteamImport` is handed by the relay to the jobs port under the same name, and the scheduler's worker runs it (`packages/core/src/imports/flowyteam/job.ts`). A relay with the scheduler elsewhere queues through a send-only pg-boss client (2 connections, no maintenance, cron or migration). With `OPENOKR_SCHEDULER=off` nothing would run the job, so preview and run are refused with reason `background_off` before anything is queued, and `imports.flowyteamConnection` returns `backgroundWork: false` |
| Q4, resume | A real run hands over between domains after 10 minutes, under the 15-minute expiry; the follow-up job carries the reconciliation so far and starts at the next domain. A preview is never split, because the rows it plans live in memory: a preview past the expiry restarts from the start |
| Q4, run row | The action writes the run row (source `flowyteam`, report `via: "export"`) in its own transaction and returns `runId`, so a run FlowyTeam refuses still has a row saying why. A second preview or run is refused (`already_running`) while an export run started in the last two hours is running |
| Engine | `requireCompany` reads `companies.count` only to word a refusal, because `mysql-only` entries are not offered over HTTP. A source with `acrossCompanies: false` (the HTTP source) skips the unread-table counts that need every company; those count rows tied to no company, so nothing of this company goes unreported |

### 2.1 The catalogue format (C1)

| Rule | Detail |
|---|---|
| Home | `packages/core/src/imports/flowyteam/queries.ts`, one entry per statement: `name`, `sql`, `scope` |
| The company | Written as the literal `:company` in the SQL, never as a positional value. The MySQL source substitutes the run's company id (escaped); FlowyTeam substitutes the token's. A call passes the company separately, and an entry with `:company` refuses a call without one |
| Other values | Positional `?`. A list is one `?` taking an array, which the MySQL client expands; an empty list is never sent |
| Scope `company` | Must contain a `company_id = :company` predicate, directly or through a joined parent. A unit test fails naming any entry that does not |
| Scope `schema` | Reads `information_schema` only, no company data (introspection, the unread-table check) |
| Scope `reference` | An existence check by id across the whole source, selecting only `id`. Used where a row owned by another company must count as present (the KPI owner check). FlowyTeam may answer it with ids only. No `:company` |
| Scope `mysql-only` | Never offered over HTTP, such as listing every company in the source. A token holds one company |
| Dynamic SQL | Every variant becomes its own named entry (the deleted-row variants in KPI shares, one count per table in the unread check), so the catalogue lists every statement that can be sent |
| Generated file | `contract/flowyteam-queries.json` with a `version` (SHA-256 of the entries), written by `pnpm gen:contract` and checked by `pnpm check:contract` |

## 3. The flow

```
Admin (OKRGoal)        OKRGoal server                  FlowyTeam
     | Connect FlowyTeam  |                                |
     |------------------->| state + PKCE verifier stored   |
     |<-- redirect -------|------------------------------->| /oauth/authorize
     |                    |                                | admin of the company? consent
     |<------------------------------- redirect with code -|
     |------------------->| exchange code (token endpoint) |
     |                    | seal token, import_connections |
     | Run preview        |                                |
     |------------------->| job: dry run                   |
     |                    | query(name, values) x n ------>| vendored SQL, company from token
     |                    |<-------------------- rows -----|  read logged
     |<-- report ---------|                                |
     | Import (+ consent) | job: write, same reads         |
     | Invite selected    | invitations                    |
```

## 4. OpenOKR side

### 4.1 Actions (registry, `packages/core/src/actions/imports-flowyteam.ts`)

| Action | Level | Does |
|---|---|---|
| `imports.flowyteamConnect` | `full` on imports | Starts authorisation: returns the FlowyTeam URL and the sealed state (`state`, PKCE verifier, workspace, member, client, 10 minutes). The route `POST /admin/imports/flowyteam/connect` keeps it in an httpOnly SameSite=Lax cookie and redirects |
| `imports.flowyteamFinishConnect`, called by the route `/admin/imports/flowyteam/callback` | `full`, session + `state` cookie | Checks the state (sealed, unexpired, same value, same workspace, same member) before any network call, exchanges the code, reads `companies.byId`, then one Operation seals the token and writes the connection with the company id and name FlowyTeam returns, plus the audit row. A replaced connection is closed and its token revoked through the outbox |
| `imports.flowyteamConnection` | `full` | The card's read: whether this instance offers connecting, and the live connection (`connected` or `revoked`). Never the token |
| `imports.flowyteamPreview` | `full` | Enqueues a dry run; refuses when the workspace already holds another company (today's rule) |
| `imports.flowyteamRun` | `full` | Enqueues the write. Requires `acceptBroaderVisibility` when the preview named restricted KPIs (today's `--accept-broader-visibility`) |
| `imports.flowyteamDisconnect` | `full` | Marks the connection revoked and disconnected (soft delete), keeps imported data and the company link. An outbox row (`imports.flowyteamRevoke`) revokes the token at FlowyTeam (RFC 7009, `POST <baseUrl>/oauth/revoke`) through the outbound guard and then clears it from the row; no answer is retried, a refusal or 404 is not |
| `imports.listRuns` | existing | Returns `via`: `export` for a browser run. As built, the source stays `flowyteam` (no migration of the `import_runs.source` check); the report and the filename carry `via` |

All writes go through the Operation pipeline. The audit rows name the acting member and the FlowyTeam company id.

### 4.2 Table `import_connections` (migration, row-level security in the same migration)

| Column | Type | Note |
|---|---|---|
| `id`, `workspace_id` | uuid | Tenant floor |
| `source` | text | `flowyteam` |
| `base_url` | text | The FlowyTeam instance; the cloud default comes from a setting (section 4.4) |
| `company_id`, `company_name` | text | As FlowyTeam returned them at consent |
| `client_id` | text | The OAuth client that asked: registered, or the client metadata document address. Revoking names it |
| `token_ciphertext`, `token_data_key`, `token_key_id` | text null | Envelope-encrypted with the key ring, in the three columns every sealed credential uses so `pnpm keys:rotate` re-wraps them. Null once a closed row's token is revoked |
| `scopes` | text | `flowyteam:export` |
| `connected_by_member_id`, `connected_at` | | |
| `last_read_at` | timestamptz | |
| `revoked_at` | timestamptz null | The token no longer works: revoked here, or refused by FlowyTeam later |
| `deleted_at` | timestamptz null | Disconnected. Soft delete scope applies |

One live connection per workspace and source (partial unique index on `deleted_at is null`, so a row FlowyTeam revoked stays visible until Connect again replaces it). Importer mapping: no legacy source (TECHNICAL-PLAN §7.2). Portability: excluded from archives, like other credentials.

### 4.3 The HTTP source (`packages/adapters`)

As built: `createHttpFlowyteamSource` and `createHttpFlowyteamFiles` in `packages/adapters/src/drivers/flowyteam/export.ts`. Values are coerced by `columns[].native_type` to what the MySQL source returns (a `LONGLONG` and a decimal as text, `JSON` parsed). A 409 is `version_mismatch`, a 401 or a 403 other than `mysql_only` is `unauthorised`, which marks the connection revoked. Every statement FlowyTeam pages has a total order, enforced by a test. A driver behind the existing outbound HTTP port: `query(name, values)` posts to FlowyTeam, follows the cursor until the result is complete and returns the rows in the shape MySQL returns today. Retries a 429 or 5xx with backoff three times, then fails the domain with the FlowyTeam answer in the report. Air gap: the request goes through the port, so `check:air-gap` sees it.

### 4.4 Settings (TECHNICAL-PLAN §4.14)

| Key | Default | Note |
|---|---|---|
| `imports.flowyteam.baseUrl` | `https://app.flowyteam.com` on the managed cloud, empty on self-hosted | Empty hides the connect step and shows the command line instead |
| `imports.flowyteam.clientId` | Empty (`OPENOKR_FLOWYTEAM_CLIENT_ID`) | The cloud uses a registered confidential client; empty means the instance identifies itself with its client metadata document at `/api/imports/flowyteam/client` (public, `client_name` OKRGoal, one redirect URI, `token_endpoint_auth_method` none), which FlowyTeam already accepts for a trusted host |
| `imports.flowyteam.clientSecret` | Empty, sealed (`OPENOKR_FLOWYTEAM_CLIENT_SECRET`) | Sent only for the registered client |

All three are instance settings in `packages/core/src/secrets/instance-registry.ts`; `imports.flowyteam.baseUrl` is bootstrapped by `OPENOKR_FLOWYTEAM_URL`. The managed cloud default is applied when the setting is empty and `cloud.enabled` is on.

### 4.5 Screen (S-36 Import)

As in the prototype: a "From FlowyTeam" card above the spreadsheet card with five steps (Connect, Choose, Preview, Import, Invite people), then a linked state with "Import new data" and the Q5 sentence. Recent runs lists both sources. Loading, empty, error, refused (not `full`), FlowyTeam unreachable, version mismatch (Q8) and revoked-in-FlowyTeam states are each drawn. Every string through the catalogue, ten languages.

## 5. Security

| Risk | Control |
|---|---|
| One token reads a whole company | Read-only scope; company admin consent; token sealed here; FlowyTeam logs each read; revocable on both sides; idle expiry on the FlowyTeam side (section 6) |
| A client sends SQL | It cannot: the request carries a name. FlowyTeam runs only its vendored statements |
| A query reaches another company | Every catalogue statement filters on `:company`, which FlowyTeam binds from the token and never from the request. A test here fails when a statement has no company predicate; FlowyTeam checks the same when it vendors the file |
| Imported content is untrusted | Unchanged: rich text is sanitised and validated as in the MySQL path |
| Broader KPI visibility | The preview names the KPIs and the run refuses without the admin's tick, as `--accept-broader-visibility` does |
| Token in logs | Never logged, decrypted only inside the job |

## 6. The FlowyTeam side (request to the FlowyTeam team)

| # | Piece | Detail |
|---|---|---|
| F1 | Scope `flowyteam:export` | Read-only. Not granted together with any other scope. Offered in discovery |
| F2 | Consent | The existing authorize page, with the company picker limited to companies where the user is an admin, and the list of what is read. A non-admin sees why they cannot approve |
| F3 | Clients | OKRGoal cloud as a confidential client registered by the super admin; self-hosted instances through the client metadata document path that already exists |
| F4b | Revocation | `POST /oauth/revoke` (RFC 7009) with `token`, `client_id` and, for a confidential client, `client_secret`. OpenOKR calls it on disconnect and treats 404 as "not offered" |
| F4 | Token lifetime | Expires after 90 days without a read. Revocable from Settings > Integrations > OKRGoal |
| F5 | `POST /api/export/v1/query` | Body `{ version, name, values, cursor }`. Runs the named statement from the vendored catalogue on a read-only connection, binds `:company` from the token, expands list values, 2,000 rows a page with a cursor. 409 on a version mismatch, 404 on an unknown name. Entries of scope `reference` return only the ids that exist |
| F6 | `GET /api/export/v1/files/{task_file_id}` | Streams one task file of the token's company |
| F7 | Read log and screen | A row per request (who approved, OKRGoal workspace, name, rows). Settings > Integrations > OKRGoal shows the connection, the log and Revoke, as in the prototype |
| F8 | Rate limit | Separate from the MCP limit, sized for an import (about 300 requests for a company of 10,000 rows) |

## 7. Acceptance criteria

1. Given a workspace admin with `full` on imports and a FlowyTeam company admin, when they connect and approve, then the card shows the company name and a sealed connection row exists, and no token appears in any log or audit row.
2. Given a FlowyTeam user who is not a company admin, when they open the consent page, then they cannot approve and are told why.
3. Given a connected workspace, when the preview runs, then its report equals the report `pnpm import:flowyteam` prints for the same company without `--write`.
4. Given a preview naming restricted KPIs, when Import is pressed without the tick, then the run is refused before any write.
5. Given a finished import, when Import new data runs with nothing new in FlowyTeam, then it writes 0 rows.
6. Given a catalogue version that differs from FlowyTeam's, when any read is sent, then the run stops before writing and the card says FlowyTeam needs an update.
7. Given a statement in the catalogue without a company predicate, when the unit suite runs, then it fails naming the statement.
8. Given the token was revoked in FlowyTeam, when Import new data is pressed, then the card says the access was revoked and offers Connect again, and the imported data is unchanged.
9. Given an import of 214 people, when it finishes, then no invitation has been sent until the admin sends them from the last step.
10. Given AI is off, then every step works; nothing in this flow uses AI.

## 8. Delivery

| Card | Repository | Content | Depends on |
|---|---|---|---|
| C1 | OpenOKR | Name every query and generate the catalogue; MySQL source by name; drift gate; company predicate test. No behaviour change | |
| C2 | OpenOKR | Move the engine to `packages/core/src/imports/flowyteam` (Q2); command line unchanged | C1 |
| C3 | OpenOKR | Migration `import_connections` with row-level security; connect, callback and disconnect | Design approved |
| C4 | OpenOKR | HTTP source driver, preview and run jobs, progress | C2, C3, F1 to F5 |
| C5 | OpenOKR | S-36 card, invite step, catalogue strings, end-to-end spec against a FlowyTeam stub | C4 |
| F1 to F8 | FlowyTeam | Section 6 | C1 (the catalogue file) |

C1 and C2 change nothing a running instance does and can ship first.

## 9. Open questions for the owner

- Who owns F1 to F8 in FlowyTeam's source, and in which FlowyTeam release.
- The cloud's FlowyTeam address and whether one OKRGoal client is shared by all cloud workspaces (recommended) or one per workspace.
