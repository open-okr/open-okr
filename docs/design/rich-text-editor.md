# The rich text editor

P2-T11. Screen S-30. Named deliverable per that task's own card: this document exists before any editor code, and CLAUDE.md's rich-text rule governs everything in it — editor JSON in `jsonb` with a version column, never Markdown as storage, parsed and rendered through one shared `packages/core` module.

No prior document pins the canonical schema down to a JSON shape or an actual node/mark list. TECHNICAL-PLAN §1 and §4 only say "editor JSON... a version integer... one shared core module owns parsing, structural validation against an allowed node and mark list, sanitised rendering, excerpting and mention extraction." This document is where that becomes concrete. Where this document and TECHNICAL-PLAN later disagree, TECHNICAL-PLAN wins and this file gets fixed, per the repository's own authority order.

## 1. Why TipTap's own JSON, not a custom shape

The stored shape is exactly what TipTap's `editor.getJSON()` produces and `editor.commands.setContent()` accepts: a ProseMirror document node tree, `{ type: "doc", content: [...] }`, where every node is `{ type, attrs?, content?, marks? }` and text nodes are `{ type: "text", text, marks? }`.

A custom, editor-independent shape was considered and rejected: it would need a translation layer both directions (editor JSON → stored shape on save, stored shape → editor JSON on load), and that translation layer is exactly the kind of code that drifts from what the editor actually produces the first time an extension's attributes change. Storing TipTap's own shape directly means the validator in §3 below is the only thing standing between "whatever the editor produced" and "what gets persisted," which is one seam to keep correct instead of two.

The cost: the stored format is coupled to ProseMirism's document model. Accepted, because CLAUDE.md already commits to TipTap over ProseMirror as the locked stack; there is no plan to swap editors.

## 2. Storage

Every rich-text-bearing column is a pair: `<name>` (`jsonb`, the document) and `<name>_version` (`integer`, the schema version the document was validated against when written). `workspace_members.bio`/`bio_version` was the only such pair in the schema when this was written (migration `0005_workspaces.sql`); every later table that needs rich text (`goals.description`, `comments.body`, `documents.body`, …) follows the identical pair, added by whichever task builds that table.

`RICH_TEXT_SCHEMA_VERSION = 1` today. A version mismatch on read is not an error: `parseRichText` accepts any version this module still knows how to read and normalises it to the current in-memory shape. There is no version 0 to migrate from and no migration path built yet, because there is nothing to migrate — this is the first version. The column exists so a future breaking schema change (removing a node type, changing an attribute) has somewhere to branch on, per TECHNICAL-PLAN's own instruction, without every existing document needing an eager rewrite.

## 3. The canonical allow-list

Structural validation rejects any node or mark type not on this list, recursively, at every depth. A document that fails validation is refused at the write boundary (the calling action's own input schema), never coerced or silently stripped — a form of "sanitise" that hides data loss is worse than a rejected write.

### Nodes

| Node | Notes |
|---|---|
| `doc` | The root. Exactly one, always. |
| `paragraph` | |
| `heading` | `attrs.level` restricted to 1, 2 or 3 — a comment or a goal description does not need six heading levels, and a flatter allow-list is fewer states the renderer and the excerpt utility both have to handle. |
| `bulletList`, `orderedList`, `listItem` | |
| `codeBlock` | No syntax-highlighting language attribute in v1 — nice to have, not asked for by S-30, and a highlighting library is a new dependency this task's card does not name. |
| `table`, `tableRow`, `tableCell`, `tableHeader` | |
| `blockquote` | |
| `horizontalRule` | |
| `hardBreak` | |
| `text` | Leaf. Carries marks. |
| `mention` | Custom, atomic, inline. `attrs: { id: string, label: string }`. `id` is a member id; resolving it to a live name is the renderer's job (§6), not stored. |
| `entityLink` | Custom, atomic, inline. `attrs: { shortId: string, label: string }`. §3's own "entity autolink by short identifier" (UIUX-PLAN §2) — `shortId` is TECHNICAL-PLAN §3's opaque per-workspace identifier; `label` is a snapshot of the entity's title at insertion time, shown until the renderer can resolve a live one. |
| `attachment` | Custom, atomic, inline. `attrs: { blobId: string, filename: string, contentType: string, status: "uploading" \| "ready" }`. See §8. |

### Marks

`bold`, `italic`, `code`, `strike`, `underline` (added by [guided-inputs.md](guided-inputs.md) §4.7), `link` (`attrs.href` restricted to `http:`, `https:` and `mailto:` — never `javascript:` or a bare unscheme string a browser might interpret as a relative path into somewhere unexpected).

### What is deliberately not here

Text colour, font family, text alignment, subscript/superscript, embedded video, and any node with a `style` attribute. None are named by S-30 or UIUX-PLAN §2, and an allow-list's value is in what it excludes — every one of these is a plain addition to the two tables above whenever a real screen asks for it, not a reason to widen the list speculatively now.

## 4. `packages/core/src/rich-text/`

The one shared module TECHNICAL-PLAN §1 names. Pure: no database, no network, no DOM — it runs identically on the server before a write, in the browser as someone types, and inside an email-rendering job, which is the same purity constraint `packages/method` already holds itself to and for the same reason.

```
packages/core/src/rich-text/
  schema.ts    Zod schema for the allow-list (§3), RICH_TEXT_SCHEMA_VERSION
  validate.ts  parseRichText(json, version) -> RichTextDocument | throws
  render.ts    renderRichTextToHtml(doc, resolvers) -> sanitised HTML string
  excerpt.ts   excerptRichText(doc, maxLength, resolvers) -> plain text
  extract.ts   extractMentionIds(doc), extractAttachments(doc) — decode-safe
```

### `validate.ts`

```ts
function parseRichText(input: unknown, version: number): RichTextDocument
```

Throws `RichTextValidationError` (with a path, e.g. `content[2].content[0]`, so a caller can say what was wrong) on: an unknown top-level shape, a node or mark type absent from §3's list, a wrong attribute type, an out-of-range `heading.level`, or a `link.href`/absent-protocol that fails the allow-list. This is the function every write action's `defineWriteAction` input schema calls for a rich column, the same way `people.updateOwnProfile` already calls `isKnownTimezone` for a timezone field.

### `render.ts`

```ts
interface RichTextResolvers {
  resolveMention?(id: string): { name: string } | undefined;
  resolveEntityLink?(shortId: string): { href: string; label: string } | undefined;
  resolveAttachment?(blobId: string): { href: string } | undefined;
}
function renderRichTextToHtml(doc: RichTextDocument, resolvers?: RichTextResolvers): string
```

Every text value is escaped; every emitted tag comes from a fixed node-type → tag-name table (never a value from the document itself). A `mention`/`entityLink`/`attachment` node renders through its resolver when one is given; with no resolver (or a resolver that returns nothing — a deleted member, a deleted entity) it falls back to the node's own `label`/`filename` as plain text, never a broken link and never an error. This is what "rendering is a sanitising allow-list at every surface, including email and exports" means concretely: the mail adapter and a future export job both call this same function, and neither can emit anything this function itself would not.

An `attachment` node with `status: "uploading"` renders as its filename with no link at all — a stored document should never have reached that state (§8's submit gating refuses it), but the renderer does not trust that and degrades safely if one somehow did.

### `excerpt.ts`

```ts
function excerptRichText(doc: RichTextDocument, maxLength: number, resolvers?: Pick<RichTextResolvers, "resolveMention">): string
```

Walks the same tree, concatenates text content with single spaces between block boundaries, renders a `mention` as `@Name` (via the resolver, falling back to `@member`) and an `entityLink`/`attachment` as its `label`/`filename`, then truncates to `maxLength` on a word boundary with a trailing `…`. Used by activity rows, the search and embedding indexes, the digest, the minutes and the AI assists.

### `extract.ts`

```ts
function extractMentionIds(input: unknown): readonly string[]
function extractAttachments(input: unknown): readonly { blobId: string | undefined; status: "uploading" | "ready" }[]
```

`blobId` is undefined for a node still uploading, which has nothing to reference yet.

Decode-safe per TECHNICAL-PLAN §4.10's explicit line: malformed or unparseable input returns `[]`, never throws. This is deliberately looser than `parseRichText` — a caller extracting mentions to notify people, or attachments to reconcile against the `attachments` table, wants "whatever I can find," not a hard failure over one bad node deep in an otherwise fine document.

## 5. Mentions

`id` is a `workspace_members.id`. Nothing enforces at write time that the mentioned member still exists or is active — the same reasoning as `render.ts`'s resolver fallback: a mention written today and read after that member is erased must degrade to plain text, not corrupt the document or refuse to render the surrounding paragraph. Fan-out (turning a mention into a notification) is the comment write's job: `packages/core/src/comments/service.ts` reads `extractMentionIds`, subscribes each member mentioned and the comment action notifies them.

## 6. Entity autolink

Typing `#` opens a suggestion popup (the same TipTap `Suggestion` mechanism as `@mention`, a second configured instance) that a caller wires to whatever entity search it has available, so the editor component takes a `searchEntities(query)` prop rather than assuming one. Selecting a result inserts an `entityLink` node with the entity's current title snapshotted into `label`. Resolving `shortId` back to a live href and a live (possibly renamed) label at render time is `render.ts`'s resolver, supplied by whichever surface actually has a database connection.

## 7. Attachments

An `attachment` node is a reference, not a copy: `blobId` names a row P2-T05's blob pipeline already owns (upload, quota, scanning). The editor's job is only to hold the reference and its transient `status` while an upload is in flight.

**Upload flow**, entirely client-side until submission:
1. A file is pasted or dropped into the editor.
2. An `attachment` node is inserted immediately with `status: "uploading"` and a client-generated placeholder `blobId` isn't real yet — attrs carry `filename`/`contentType` from the `File` object and no `blobId` until the upload resolves; the node view (§9) shows a progress affordance in that state.
3. The caller's own upload function (P2-T05's `prepareBlob`/upload flow, via a prop, not a direct import — `packages/ui` does not reach into `packages/core` for this) resolves to a real `blobId`, and the node's attrs update to `status: "ready"` with that id.
4. A failed upload removes the node rather than leaving a permanently-broken reference — "deletion on failure," per the task's own build list.

**Submit gating**: before a submit handler is allowed to fire, the editor component checks for any attachment node still `"uploading"` (`hasUploadsInProgress()` on its handle) and refuses (with a visible reason, not a silent no-op) if any are still in flight. This is the literal acceptance line: "given a comment with an upload in flight, when the user submits, then submission waits for the upload or fails loudly, never dropping the attachment silently." The gating lives in the editor component (`packages/ui`), because it is the one place that knows the live upload state. The server check is `filesFinished` in `rich-text/field-schema.ts`, used by `richTextSchema()` and by the comment write's own schema (§11 D1, plan 0.7.0 R1): a write naming a file still `"uploading"`, or `"ready"` with no `blobId`, is refused, since a client is never fully trusted at the write boundary.

The `attachments` row for a file in the text is written by the comment and document writes themselves, through `reconcileTextAttachments` in `packages/core/src/attachments/text.ts`, inside each write's own Operation (§11, plan 0.7.0 R2).

## 8. Draft autosave

Client-side only, `localStorage`, per TECHNICAL-PLAN's "draft autosave keyed per entity and user" (UIUX-PLAN §2) and §4's "fingerprinted against the base content with an expiry."

```
key:   openokr:draft:<entityType>:<entityId>:<memberId>
value: { content: RichTextDocument; baseFingerprint: string; savedAt: number; expiresAt: number }
```

`baseFingerprint` is a cheap non-cryptographic hash (the same rolling-hash approach as `avatarToneFor` in P2-T10, not a cryptographic digest — this only needs to detect "did the base content change," not resist tampering) of the content the editor was initialised with. On mount, a caller reads the stored draft, recomputes the fingerprint of the *current* base content, and discards the draft outright if the two disagree — "a draft against changed base content does not resurrect" is exactly this comparison, not a merge or a warning. `expiresAt` (14 days from `savedAt`) is checked the same way: an expired draft is discarded on read, never surfaced. A save autosaves on a debounced interval while the editor has focus and is cleared on successful submit.

## 9. The editor component

`packages/ui/src/rich-text/editor.tsx`, wrapping `@tiptap/react`'s `useEditor`/`EditorContent`. Extensions, each mapped to exactly one row of §3's tables — nothing pulled in for convenience that is not on the allow-list:

- `@tiptap/starter-kit`, configured to disable `dropcursor`, `gapcursor`, `undoRedo`, `underline`, `listKeymap` (all bundled by default in the installed version, none on the allow-list) and to configure `heading: { levels: [1, 2, 3] }` and `link: { openOnClick: false, protocols: ["http", "https", "mailto"] }`.
- `@tiptap/extension-table` (bundles `Table`/`TableRow`/`TableCell`/`TableHeader` in the installed version).
- `@tiptap/extension-mention` + `@tiptap/suggestion`, one configured instance for `@` (members) and a second for `#` (entity autolink, §6) — `@tiptap/extension-mention` names its own trigger character per instance, so both live side by side rather than needing a fully custom node for one of them.
- A hand-written `Node.create({ name: "attachment", ... })` (`@tiptap/core`), atomic and inline, with `addNodeView()` rendering the upload/ready states described in §7.
- A local `Underline` mark (`packages/ui/src/rich-text/underline.ts`), since underline joined the allow-list; StarterKit's own stays off.

A slash-command menu (`/` opens a picker for heading/list/table/code-block/quote) is `@tiptap/suggestion` a third time, triggered on `/` at the start of an empty block, matching UIUX-PLAN §2's "slash commands" line. Only the `full` variant has it.

TECHNICAL-PLAN §1's own package table restricts `packages/ui` to depending on `packages/method` only — never `packages/core`, where §4's validator lives. The editor component takes an optional `validate?: (json: unknown) => boolean | Promise<boolean>` prop instead of importing `parseRichText` directly; a host wires the real function in. This is the same dependency-injection shape as `searchEntities` (§6) and the upload function (§7), for the identical reason: `packages/ui` cannot reach across that boundary, so anything on the other side of it arrives as a prop. The editor calls `validate` on every update; what a caller does with the result (and whether it surfaces a warning at all) is entirely the caller's own closure — the component does not interpret the return value itself. Either way this is a client-side early warning, not the enforcement — `bioInputSchema`'s own call to `isValidRichText` at the write boundary (§10) is what actually refuses a bad document, exactly as `packages/core`'s access rules are never satisfied by a client-side check alone.

`validate` is `async` for a reason discovered the hard way, not designed in from the start: `packages/core`'s barrel (`index.ts`) re-exports its Postgres/Drizzle code alongside the pure rich-text functions, and *any* Client Component that imports anything from that barrel — not just `packages/ui`, `apps/web` too — pulls the whole module graph into the browser bundle, including Node built-ins (`net`, `tls`, `util/types`) a browser cannot resolve. `tsc` sees nothing wrong with this; only `pnpm build`'s actual bundler catches it, which is what happened to `apps/web/app/dev/rich-text`'s own preview page before this line existed. The fix generalises: a Client Component never imports `@openokr/core` directly, full stop, even in `apps/web` where the package boundary check would otherwise allow it. The real function reaches a validating prop through a Server Action (`"use server"`), which is why the prop has to be `async` — a Server Action is the *only* shape "hand a browser-side caller something backed by `@openokr/core`" can take, so a synchronous signature here was a promise this prop could never have kept.

## 10. What this task does not build

- Any actual consumer: no `comments`, `documents`, `goals.description` or similar rich-text-bearing table existed yet (all were later phases). The one real integration point then was `workspace_members.bio`/`bio_version`, upgraded from `z.unknown()` (P2-T03's own placeholder) to `parseRichText` against this schema — P2-T03's STATUS.md row named exactly this as the thing it was waiting on.
- Syntax highlighting in code blocks, text colour, alignment — see §3's exclusion list.
- A server-side mention-to-notification fan-out, or an attachment-join-row writer. The fan-out arrived with comments (§5); the row writer arrived at release 0.7.0 (§11).
- Email/export rendering surfaces calling `renderRichTextToHtml` — the function is built and tested against synthetic documents; wiring it into the mail adapter or an export job is that job's own task.

## 11. Attachment rows from the text, and the upload check (release 0.7.0, R1 and R2)

Status: proposed 9 November 2026 for release 0.7.0 (plan R2). Approved by Akmal on 9 November 2026 ("design approved"). Q1: yes, data change 0033, with the upgrade notes saying what it opens. Q2: yes, a separate interface change, added to the plan as its own row. A schema change, so it is designed first (CLAUDE.md). R1 needs no design; it is here because it guards the same write, and D16 says how the two ship. Built: R1, then R2 with migration 0155 and data change 0033. §11.10 lists where the build settled something this section left open.

### 11.1 What exists

| Piece | Where | Today |
|---|---|---|
| The node | `packages/core/src/rich-text/schema.ts:84-90` | `attachment` with a filename, a content type, `uploading` or `ready`, and a `blobId` that is optional whatever the status |
| Extraction | `rich-text/extract.ts` | `extractAttachments` is decode-safe and has no caller outside its test and the barrel export (`index.ts:1055`) |
| The write boundary | `rich-text/field-schema.ts` `richTextSchema()`; `actions/comments.ts:50-56` and `actions/people.ts:85` keep their own | All three accept an `uploading` node. §7 says a server check "sits in the shared validator too". It does not |
| The read path | `apps/web/lib/rich-text-html.ts:18-28` | Validates, then renders with no resolvers, so an attachment is its filename with no link (`render.ts:104-117`) |
| Attachment rows | `actions/documents.ts:1206-1316` `attachments.attach`, `1318-1383` `attachments.detach` | The only writer. The files panel on goals, tasks, spaces, initiatives and the cycle calls it |
| The subject check | `packages/db/migrations/0066_documents.sql:104-109`; `ATTACHMENT_SUBJECT_TYPES` in `packages/db/src/schema/documents.ts:40-50` | Nine subjects, no `comment` |
| Who may download | `actions/blobs.ts:331-445` `blobs.getForDownload`; `documents.ts:1167-1204` `readableThroughAttachment` | The uploader, or whoever reads a subject the blob hangs on through a live row. A blob named in text with no row is the uploader's alone |
| The editor | `packages/ui/src/rich-text/editor.tsx:229-243, 300-340` | Inserts an `uploading` node and makes it `ready` when `uploadFile` resolves. No screen passes `uploadFile`; only `/dev/rich-text` does |
| The importer | `packages/importer/src/flowyteam/mappers/files.ts:336-467` | Stores each inline comment image as a blob, uploaded by whoever runs the import, then rewrites the body through `comments.replaceImportedBody` (`comments.ts:485-562`). No row, so only that person can open those images |
| The orphan reap | `blobs.ts:468-554`, `blobs/provisioning.ts:285-310` | Removes blobs still `pending`, prepared and never claimed, past `orphanBlobMinutes`. A claimed blob is never reaped |

So an attachment in text links nowhere today, and in the one place real data holds such nodes, imported comments, colleagues cannot open the picture.

### 11.2 Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **R1:** the write boundary refuses an attachment that is `uploading`, or `ready` with no `blobId`: "A file in this text is still uploading. Wait for it to finish, then save." One refinement in `field-schema.ts`, used by `richTextSchema()`; comments and the bio move onto it | §7's promise, made true at the one boundary every rich text write crosses |
| D2 | R1 is not in `parseRichText` | The read path calls it (`rich-text-html.ts:21`). A stricter parser would hide a stored document that was valid when written |
| D3 | **R2:** six writes reconcile the subject's text rows inside their own Operation: `comments.create`, `comments.update`, `comments.importComment`, `comments.replaceImportedBody`, `documents.create`, `documents.update`. One helper, `reconcileTextAttachments`, in `packages/core/src/attachments/` | The six cannot differ. Mentions already work this way (`reconcileMentions` in `comments/service.ts`) |
| D4 | A row the text placed has `origin = 'text'`; a panel row has `panel`. The reconcile touches only `text` rows | A file attached through the panel is not in the text, and a reconcile that could not tell the two apart would remove it at the next edit |
| D5 | In the text with no live row: insert, as `text`, after the highest position, in order of appearance. In the text with a live row of either origin: nothing. A live `text` row no longer in the text: soft delete. A `panel` row: never touched | Soft delete is the default. Putting the file back later writes a new row, which the partial unique index allows |
| D6 | For a document, "in the text" is the current body **or any published version's body** | Versions are kept and read (`documents.difference`), and a picture in version 1 must still open after version 2 dropped it. A file only ever in an unpublished draft goes when the draft drops it |
| D7 | Before inserting, the writer must be able to open the blob, by `blobs.getForDownload`'s rule: their own upload, or one readable through a live row they reach. Otherwise the write is refused with not-found: "A file in this text is not one you can share here." | Without it, another member's blob id in a comment would publish their private file to every reader. `attachments.attach` asks the same (`documents.ts:1226-1233`) |
| D8 | A blob that is `pending`, deleted or not in this workspace refuses the write. `scanning` and `quarantined` are accepted, as the panel accepts them; the download refuses both until cleared | `pending` means the bytes were never claimed and the reap takes it within a day, so a row would point at nothing |
| D9 | Deleting a comment or a document leaves its rows. Access through a deleted subject fails, so its files close with it, and `documents.restore` brings them back | The rule the document delete already keeps: "the delete takes the document alone" |
| D10 | `attachments.detach` refuses a `text` row: "This file is in the text. Take it out of the text instead." | Otherwise the panel and the text disagree, and the next edit puts the row back |
| D11 | `comment` joins the table's check and `ATTACHMENT_SUBJECT_TYPES`, **not** the inputs of `attachments.attach` and `attachments.list`, which keep a list of their own | A file reaches a comment through its text only. Nobody needs a panel to hang a file on somebody else's comment |
| D12 | `requireAttachmentSubject` gains `comment`, resolved by `SUBJECT_RESOLVERS.comment` (`access/reads.ts:524`), the walk a reaction on a comment takes | So `readableThroughAttachment` lets a reader of the comment open its file |
| D13 | Each of the six actions' audit payload gains `attachmentsAdded` and `attachmentsRemoved`, blob ids only. No new activity kind | The comment's own activity is the feed line. The trail still says which files a write shared |
| D14 | Comments and documents render a `ready` attachment as a link to `/api/blobs/<blobId>`, which decides access. `richTextHtml` takes the resolver. Email keeps the filename | Without the link the rows change nothing a person sees. A mail reader is not signed in |
| D15 | The orphan reap does not change | `storeUpload` prepares, writes and claims before the node turns `ready`, so a blob in a `ready` node is never `pending` |
| D16 | **R1 ships first, alone; R2 follows on top of it once approved; both in 0.7.0** | R1 needs no design and covers every rich text field. With it in place every stored node is `ready` with a `blobId`, so the reconcile never meets half an upload |

### 11.3 The migration

`0155_attachment_origin.sql`:

```sql
alter table attachments drop constraint attachments_subject_type_check;
alter table attachments add constraint attachments_subject_type_check
  check (subject_type in ('space', 'goal', 'key_result', 'initiative', 'cycle',
    'session', 'task', 'document', 'check_in', 'comment'));
alter table attachments
  add column origin text not null default 'panel'
  check (origin in ('panel', 'text'));
```

- Forward-only and additive. Nothing is renamed or removed, so one release is enough; expand-then-contract governs removals.
- A constant default changes only the catalogue in Postgres 11 and later, with no table rewrite. Every existing row is a panel row, which is what each one is.
- No new policy: `attachments` has carried `workspace_id` and its policy since 0066.
- During a rolling upgrade an old pod writes rows without `origin` and gets `panel`, which is right. An old pod serving a download that meets a `comment` row fails that download, because its subject check knows no `comment`. That is a file nobody but its uploader could open before. Nothing is written wrong.
- The workspace archive carries the column and the value. An older instance already refuses a newer archive (`portability/archive.ts:262`).

### 11.4 What happens to a blob named by text

| Case | After this change |
|---|---|
| Named in text, writer can open it, claimed | A `text` row. Every reader of the comment or document opens it |
| Named in text, another member's private file | The write is refused (D7) |
| Named in text, `pending` or gone | The write is refused (D8) |
| Uploaded in the editor, taken out before posting | Claimed, no row, the uploader's alone, counted against the quota, never reaped. As today |
| Imported inline image | A `text` row, written by `comments.replaceImportedBody` |
| Imported before 0.7.0 | Q1 |

Reaping a claimed blob with no row is out of scope. Avatars, logos, favicons, exports and archives hold blobs without an attachment row, so "no row" does not mean "unused".

The spreadsheet importer writes no comments or documents. The FlowyTeam task files keep going through `attachments.attach` as `panel` rows.

### 11.5 Open questions

**Q1.** Workspaces imported before 0.7.0 hold comments whose images only the importer's runner can open. Data change `0033_attachment_rows_from_text` would insert `text` rows for each `ready` node whose blob is live in the same workspace and either was uploaded by the body's author or sits in an imported comment (one with a legacy key). Anything else is skipped and counted. It is SQL over `jsonb_path_query`, because `packages/db` cannot import `extractAttachments`. It touches stored data and changes who can open existing files, which is why it is yours. **Proposed: yes, through `pnpm db:change`, with the upgrade notes saying what it opens.**

**Q2.** No screen lets a person paste or drop a file into a comment or a document: `uploadFile` is passed only on `/dev/rich-text`. Wiring it into the comment composer and the document editor is the change that makes R1 and R2 reachable from a browser. **Proposed: a separate interface change after R2, added to the plan as its own row.**

### 11.6 Acceptance criteria

- Given a comment body holding a `ready` node for a file Ana uploaded, when Ana posts it, then one live row (`comment`, its id, the blob, `text`) exists, and Ben, who reads the goal, opens the file from the comment.
- Given that comment, when Ana edits the image out, then the row is soft-deleted and Ben's download is not-found.
- Given an edit that changes only words, when it saves, then the rows are unchanged.
- Given Carl's private file, when Ana posts a comment naming its blob, then the write is refused with not-found and no comment exists.
- Given any rich text field holding an `uploading` node, when it is saved through any surface, then it is refused with R1's sentence and nothing is written.
- Given a `ready` node whose blob is `pending`, when it is saved, then it is refused.
- Given a document published as version 1 with an image, when its draft drops the image, then the row stays and version 1's image opens. Given an image only in an unpublished draft, when it is dropped, then its row is soft-deleted.
- Given a file attached to a document through the panel, when the document's body is edited, then the panel row is untouched.
- Given a `text` row, when `attachments.detach` names it, then it is refused.
- Given a FlowyTeam import with an inline image, when the files domain runs, then the comment has a `text` row and every reader of the task opens the picture.
- Given a deleted comment that held an image, when Ben asks for the file, then it is refused.

### 11.7 Tests

| Kind | File | Covers |
|---|---|---|
| Unit | `packages/core/test/rich-text-field-schema.test.ts` (existing) | R1: `uploading`, `ready` with no `blobId`, a clean document |
| Integration | `packages/core/test/attachments-from-text.test.ts` | D5 to D13 row by row, and the six actions reconcile with their audit payload. One file rather than three, so each decision is read in one place |
| Integration | `packages/importer/test/flowyteam-files.test.ts` (existing, needs MySQL) | Inline images get `text` rows |
| Integration | `packages/db/test/data-change.test.ts` (existing) | Q1's change: idempotent, skips and counts, and runs as the table owner under the tenant floor |
| Unit | `apps/web/test/rich-text-file-links.test.tsx`, `attachment-preview.test.tsx` (existing) | D14's link, a reader's document, and the panel offering no detach for a `text` row |
| End to end | `e2e/s29-documents.spec.ts` (extend) | A published document's image is a link a second member opens. Comes with R4, which is what lets a browser put a file in the text |

### 11.8 Documents changed in the same change

- This document: §4 (`ExtractedAttachment.blobId` may be undefined), §7 (where the server check lives, and who writes the rows) and §10.
- TECHNICAL-PLAN §4.9: the `attachments` row gains `origin` and `comment`.
- TECHNICAL-PLAN §7.2: the inline-image row says the comment now carries a `text` row.
- DATABASE.md: the `attachments` row.
- `contract/*.json` regenerated: `attachments.list` returns `origin`.
- The upgrade notes for 0.7.0: Q1's change, and R1's refusal for any client that sends an `uploading` node.

### 11.9 What this does not do

- It does not reconcile files in other rich text fields, such as a goal's description or a check-in note. Those still render a filename only.
- It does not let a person paste a file into a comment from the browser (Q2).
- It does not reap a claimed blob nobody attached.
- It does not render an image inline. A ready attachment is a link, as `render.ts` already draws it.

### 11.10 As built

Where the build settled something §11.2 left open. None changes a decision.

| Point | Built as | Why |
|---|---|---|
| D6, a file only in a published version | Keeps its row; never adds one. A new row comes only from the body being written | The writer cannot change a version, so a version must never be the reason their write is refused by D7 |
| D7 and D8, the sentences | Not the writer's to share, missing, deleted or in another workspace: not-found, "A file in this text is not one you can share here." `pending`: forbidden, "A file in this text never finished uploading. Take it out and add it again." | Access is asked first, so a file the writer cannot open answers alike whether or not it exists. A `pending` file the writer can open is their own failed upload, and saying so tells them what to do |
| D7, the writer | The acting member. For `comments.importComment` and `comments.replaceImportedBody` that is whoever runs the import, who uploaded what it brought in | The rule asks whoever is showing the file to others |
| D12, where the rules live | `requireAttachmentSubject`, `readableThroughAttachment` and a new `canOpenBlob` moved to `packages/core/src/attachments/access.ts`; the document read rules they need to `packages/core/src/documents/access.ts`. `blobs.getForDownload` asks `canOpenBlob` | One rule for the download and the write, without the action files importing each other |
| D14, a document | A reader who cannot edit sees the server-rendered text, where a file is a link. An editor keeps the editor | A read-only editor draws every file as a chip with no link |
| D10, the files panel | A `text` row shows "In the text. Take it out of the text to remove it." and no Detach | A button the server refuses is a dead end |
| Q1, the batch | One workspace a batch, listed through the scheduler's read-only scan setting and opened through its own tenant setting. The runner gained an optional `rowsSkipped`, reported for the run and printed by `pnpm db:change`, not kept in the ledger | A deployment's admin role may be the table owner, which FORCE ROW LEVEL SECURITY binds. Lifting the floor would lock live tables |
| Q1, which text | Comments and documents whether deleted or not, and every published version | Rows on a deleted subject open nothing (D9), and `documents.restore` brings them back with the document |

### 11.11 Q2 as built: a file pasted or dropped into the text (plan 0.7.0 R4)

| Piece | Built as |
|---|---|
| The upload | `uploadTextFile` in `apps/web/lib/attachment-actions.ts`: the files panel's own `storeUpload` (prepare, write, claim), without the attach. The comment or document write records the row when the text is saved. No new endpoint |
| The editor's `uploadFile` | `useTextFileUpload` in `apps/web/lib/text-file-upload.ts`. It resolves with the stored blob's id, so a node turns `ready` only once the file is claimed. A refusal is kept for the field to show and the promise rejects, so the editor takes the node out (§7 step 4) and the person is told why |
| Where | The comment composer and a comment's edit (`SubjectComments` passes it), and the document editor. Other rich text fields still take no file: their text records no rows (§11.9) |
| Saving while a file uploads | Post and Save refuse with a sentence while a node is `uploading`; the server refuses the same (R1) |
| The field | Says "Paste or drop a file to attach it." under the text where a file can go in. The node's spinner and remove button are named in the reader's language, and the remove button is drawn only where the text can change |
| A member who may not upload | `blobs.prepareUpload` needs edit. The refusal is shown beside the field and the node goes |
