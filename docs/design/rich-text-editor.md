# The rich text editor

P2-T11. Screen S-30. Named deliverable per that task's own card: this document exists before any editor code, and CLAUDE.md's rich-text rule governs everything in it — editor JSON in `jsonb` with a version column, never Markdown as storage, parsed and rendered through one shared `packages/core` module.

No prior document pins the canonical schema down to a JSON shape or an actual node/mark list. TECHNICAL-PLAN §1 and §4 only say "editor JSON... a version integer... one shared core module owns parsing, structural validation against an allowed node and mark list, sanitised rendering, excerpting and mention extraction." This document is where that becomes concrete. Where this document and TECHNICAL-PLAN later disagree, TECHNICAL-PLAN wins and this file gets fixed, per the repository's own authority order.

## 1. Why TipTap's own JSON, not a custom shape

The stored shape is exactly what TipTap's `editor.getJSON()` produces and `editor.commands.setContent()` accepts: a ProseMirror document node tree, `{ type: "doc", content: [...] }`, where every node is `{ type, attrs?, content?, marks? }` and text nodes are `{ type: "text", text, marks? }`.

A custom, editor-independent shape was considered and rejected: it would need a translation layer both directions (editor JSON → stored shape on save, stored shape → editor JSON on load), and that translation layer is exactly the kind of code that drifts from what the editor actually produces the first time an extension's attributes change. Storing TipTap's own shape directly means the validator in §3 below is the only thing standing between "whatever the editor produced" and "what gets persisted," which is one seam to keep correct instead of two.

The cost: the stored format is coupled to ProseMirism's document model. Accepted, because CLAUDE.md already commits to TipTap over ProseMirror as the locked stack; there is no plan to swap editors.

## 2. Storage

Every rich-text-bearing column is a pair: `<name>` (`jsonb`, the document) and `<name>_version` (`integer`, the schema version the document was validated against when written). `workspace_members.bio`/`bio_version` is the only such pair that exists in the schema today (migration `0005_workspaces.sql`); every later table that needs rich text (`goals.description`, `comments.body`, `documents.body`, …) follows the identical pair, added by whichever task builds that table.

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

`bold`, `italic`, `code`, `strike`, `link` (`attrs.href` restricted to `http:`, `https:` and `mailto:` — never `javascript:` or a bare unscheme string a browser might interpret as a relative path into somewhere unexpected).

### What is deliberately not here

Underline, text colour, font family, text alignment, subscript/superscript, embedded video, and any node with a `style` attribute. None are named by S-30 or UIUX-PLAN §2, and an allow-list's value is in what it excludes — every one of these is a plain addition to the two tables above whenever a real screen asks for it, not a reason to widen the list speculatively now.

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

Walks the same tree, concatenates text content with single spaces between block boundaries, renders a `mention` as `@Name` (via the resolver, falling back to `@member`) and an `entityLink`/`attachment` as its `label`/`filename`, then truncates to `maxLength` on a word boundary with a trailing `…`. Used by the inbox and the feed's own row summaries once those exist; nothing calls it yet, the same "built ahead of its consumer" position P2-T06/T07 already left several utilities in.

### `extract.ts`

```ts
function extractMentionIds(input: unknown): readonly string[]
function extractAttachments(input: unknown): readonly { blobId: string; status: "uploading" | "ready" }[]
```

Decode-safe per TECHNICAL-PLAN §4.10's explicit line: malformed or unparseable input returns `[]`, never throws. This is deliberately looser than `parseRichText` — a caller extracting mentions to notify people, or attachments to reconcile against the `attachments` table, wants "whatever I can find," not a hard failure over one bad node deep in an otherwise fine document.

## 5. Mentions

`id` is a `workspace_members.id`. Nothing enforces at write time that the mentioned member still exists or is active — the same reasoning as `render.ts`'s resolver fallback: a mention written today and read after that member is erased must degrade to plain text, not corrupt the document or refuse to render the surrounding paragraph. Fan-out (turning a mention into a notification) is a future consumer's job, using `extractMentionIds`, the same "engine built, no caller wired yet" position as P2-T06's `notifyRecipients`.

## 6. Entity autolink

Typing `#` opens a suggestion popup (the same TipTap `Suggestion` mechanism as `@mention`, a second configured instance) that a caller wires to whatever entity search it has available — `packages/core` has no search of its own yet (S-32's index is unbuilt), so the editor component takes an `entitySearch(query): Promise<{shortId, label}[]>` prop rather than assuming one. Selecting a result inserts an `entityLink` node with the entity's current title snapshotted into `label`. Resolving `shortId` back to a live href and a live (possibly renamed) label at render time is `render.ts`'s resolver, supplied by whichever surface actually has a database connection.

## 7. Attachments

An `attachment` node is a reference, not a copy: `blobId` names a row P2-T05's blob pipeline already owns (upload, quota, scanning). The editor's job is only to hold the reference and its transient `status` while an upload is in flight.

**Upload flow**, entirely client-side until submission:
1. A file is pasted or dropped into the editor.
2. An `attachment` node is inserted immediately with `status: "uploading"` and a client-generated placeholder `blobId` isn't real yet — attrs carry `filename`/`contentType` from the `File` object and no `blobId` until the upload resolves; the node view (§9) shows a progress affordance in that state.
3. The caller's own upload function (P2-T05's `prepareBlob`/upload flow, via a prop, not a direct import — `packages/ui` does not reach into `packages/core` for this) resolves to a real `blobId`, and the node's attrs update to `status: "ready"` with that id.
4. A failed upload removes the node rather than leaving a permanently-broken reference — "deletion on failure," per the task's own build list.

**Submit gating**: before a submit handler is allowed to fire, the editor component checks `extractAttachments(doc).some(a => a.status === "uploading")` and refuses (with a visible reason, not a silent no-op) if any are still in flight. This is the literal acceptance line: "given a comment with an upload in flight, when the user submits, then submission waits for the upload or fails loudly, never dropping the attachment silently." The gating lives in the editor component (`packages/ui`), because it is the one place that knows the live upload state; a server-side belt-and-braces check (refusing a write whose extracted attachments include any `"uploading"` status) sits in the shared validator too, since a client is never fully trusted at the write boundary.

Nothing writes an `attachments` join row (P2-T05's table) from this task: that row belongs to the entity the rich text is attached to (a comment, a document), and none of those tables exist yet. `extractAttachments` is what a future comment/document action calls, inside its own `Operation`, to insert the join rows atomically with the write — documented here as the contract, not built here as a caller with nothing to call it on.

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

A slash-command menu (`/` opens a picker for heading/list/table/code-block/quote) is `@tiptap/suggestion` a third time, triggered on `/` at the start of an empty block, matching UIUX-PLAN §2's "slash commands" line.

TECHNICAL-PLAN §1's own package table restricts `packages/ui` to depending on `packages/method` only — never `packages/core`, where §4's validator lives. The editor component takes an optional `validate?: (json: unknown) => boolean` prop instead of importing `parseRichText` directly; a host in `apps/web` wires the real function in. This is the same dependency-injection shape as `entitySearch` (§6) and the upload function (§7), for the identical reason: `packages/ui` cannot reach across that boundary, so anything on the other side of it arrives as a prop. The editor calls `validate` on every update and surfaces a visible warning when it returns `false`, but this is a client-side early warning, not the enforcement — `bioInputSchema`'s own call to `isValidRichText` at the write boundary (§10) is what actually refuses a bad document, exactly as `packages/core`'s access rules are never satisfied by a client-side check alone.

## 10. What this task does not build

- Any actual consumer: no `comments`, `documents`, `goals.description` or similar rich-text-bearing table exists yet (all are later phases). The one real integration point today is `workspace_members.bio`/`bio_version`, upgraded from `z.unknown()` (P2-T03's own placeholder) to `parseRichText` against this schema — P2-T03's STATUS.md row named exactly this as the thing it was waiting on.
- Syntax highlighting in code blocks, text colour, alignment, underline — see §3's exclusion list.
- A server-side mention-to-notification fan-out, or an attachment-join-row writer — both are `extractMentionIds`/`extractAttachments` callers that do not exist yet, per §5 and §7.
- Email/export rendering surfaces calling `renderRichTextToHtml` — the function is built and tested against synthetic documents; wiring it into the mail adapter or an export job is that job's own task.
