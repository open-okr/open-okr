# Workspace logo and favicon

An administrator uploads a logo and a favicon on Admin, Branding (S-36). A
card previews the chosen image before it is saved. Requested by the product
owner on 2 November 2026. Authority: REQUIREMENTS.md §5 Admin ("branding"),
TECHNICAL-PLAN.md §4.9 (blobs) and §4.14 (settings map), UIUX-PLAN.md S-36.

## 0. What already exists

| Component | Where | What it gives this change |
|---|---|---|
| Branding card, brand colour only | `apps/web/app/admin/branding/` | The card and the save and reset actions this extends |
| `workspaces.settings.branding` (jsonb) | TECHNICAL-PLAN §4.14 | A place for two blob ids. No migration |
| One upload path | `packages/core/src/blobs/upload.ts`, `storeUpload()` | Validate, re-encode, thumbnail, quota, claim. PNG, JPEG, GIF, WebP. SVG refused on purpose |
| Avatar upload | `apps/web/app/people/[id]/avatar-form.tsx`, `apps/web/app/people/actions.ts` | The form pattern and the server action shape |
| Mail port | `packages/adapters/src/ports/mail.ts` | No attachments. An image in an email must be fetched from an address |

## 1. Split into two changes

| Change | Scope | Why separate |
|---|---|---|
| **A (this document)** | Upload logo and favicon, the preview card, the logo in the sidebar tile and the workspace switcher, the favicon on signed-in screens | Uses only existing paths. No new public route |
| **B (later, own design)** | The logo in notification email | An email client has no session, so the logo needs a public address. That is a change to access, and the rule is design first |

## 2. Decisions

| Question | Decision | By |
|---|---|---|
| Whose logo | The workspace's. The sign-in page keeps the product's own mark, because nobody there has a workspace yet | Product owner, 2 Nov 2026 |
| Formats | PNG, JPEG, WebP. No SVG, no ICO: the upload path refuses SVG because it can carry script | Product owner, 2 Nov 2026 |
| Size ceiling | 2 MB per image, a constant in `packages/core` (like `MAX_BLOB_BYTES`), not a setting | This design |
| Stored where | `settings.branding.logoBlobId` and `settings.branding.faviconBlobId`, through a new write action `settings.setWorkspaceBrandingImage` (`slot`: `logo` or `favicon`, `blobId` or null; `full` access; the setting, the bindings, the activity and the audit row in one transaction) | This design |
| Default | No logo: the initials tile as today. No favicon: the product icon. A fresh workspace needs nothing set | CLAUDE.md, settings rule |
| Who can change | Whoever can save the branding card today (workspace admin) | Unchanged |
| Who can see | Every member of the workspace, the way an avatar is shared (`shareAvatar` in `packages/core/src/people/profile.ts`): setting an image binds the workspace's standard group at `view` on the blob's context, and replacing or removing it takes that binding back. No new read path in `blobs.getForDownload`. A guest sees the initials, as a guest sees initials for avatars | Checked 2 Nov 2026: the avatar tests pass, so the mechanism is proven |

## 3. The card

One card per image, under the colour card: "Logo" and "Favicon".

| State | Shown |
|---|---|
| Nothing stored | The default (initials tile, or product icon) and "Choose an image" |
| Stored | The stored image, "Replace" and "Remove" |
| Image chosen, not saved | **The preview card** (below), with "Save" and "Cancel" |
| Uploading | "Saving..." on the button, which cannot be pressed twice |
| Refused | The reason in an alert: wrong type, over 2 MB, not an image, too many pixels |

**The preview card** appears the moment a file is chosen, before any upload.
It reads the file in the browser (`URL.createObjectURL`), so nothing is sent
until Save.

| Image | Preview shows |
|---|---|
| Logo | The file name and size; the logo in a mock sidebar header, once on the light surface and once on the dark one, at the real size (32 px tile) |
| Favicon | The file name and size; a mock browser tab with the icon at 16 px and at 32 px, beside the workspace name |

A chosen file over 2 MB or of the wrong type is refused in the browser at once,
with the same sentence the server gives. The server check is the enforcement.

Remove sets the id to null and the default returns, and the old file stops
being shared. Nothing is deleted by hand.

**The colour save keeps the images.** `settings.updateWorkspaceBranding`
replaces the branding object, and the colour card used to send only the
colour. It now carries the stored image ids over and ignores image ids in its
input, so the colour card cannot drop a logo, and no caller can set an image
without the checks and the sharing above. The colour card's Reset clears the
colour only.

## 4. Where the images appear

| Place | Rule |
|---|---|
| Sidebar header tile (today "AW") | The logo, `object-contain`, in the same 32 px square. No logo: initials |
| Workspace switcher | The switcher's brandmark is the sidebar tile above, so it shows the active workspace's logo. The list of other workspaces is a native `<select>`, which cannot hold an image, so it keeps names only |
| Browser tab, signed-in screens | The favicon, through `generateMetadata` `icons` in the root layout. The sign-in page keeps the product icon |

## 5. Settings map

TECHNICAL-PLAN §4.14, Branding row gains: "Logo and favicon (`logoBlobId`,
`faviconBlobId`): none until uploaded; the initials tile and the product
icon are the defaults." DATABASE.md is not touched: no column changes.

## 6. Acceptance criteria

**Given** an administrator on Branding with no logo, **when** they choose a
PNG under 2 MB, **then** the preview card shows it in the light and dark
sidebar mock before anything is uploaded.

**Given** the preview is shown, **when** they press Cancel, **then** nothing
is uploaded and the card returns to its previous state.

**Given** the preview is shown, **when** they press Save, **then** the logo is
stored, the sidebar tile shows it on the next render, and an audit row names
the administrator.

**Given** a chosen SVG, or a file over 2 MB, **when** it is chosen, **then** it
is refused with a sentence that says why, and no preview card appears.

**Given** a stored favicon, **when** any member opens a signed-in screen,
**then** the tab shows it; the sign-in page still shows the product icon.

**Given** a stored logo, **when** an administrator presses Remove, **then** the
initials return everywhere.

**Given** a member who is not an administrator, **when** they post to the
upload action directly, **then** it is refused.

## 7. Tests

| Test | Kind |
|---|---|
| The 2 MB ceiling and the type list for branding images | Unit, `packages/core` |
| `settings.setWorkspaceBrandingImage`: a colleague reads the logo, a replaced one is withdrawn, a non-image, somebody else's file and a file over 2 MB are refused, a non-administrator is refused; the colour save keeps the images; `settings.readForMember` returns the ids | Integration, `packages/core/test/branding-images.test.ts` |
| The browser check: type, size and empty file refused; the stored image drawn from its thumbnail | Unit, `apps/web/test/branding-image.test.ts` |
| Upload logo and favicon, see the sidebar and the tab icon, remove | End to end, `e2e/s36p-branding-images.spec.ts` |

## 8. What this change does not do

- No logo in email (change B).
- No logo or favicon on the sign-in page or for the instance as a whole.
- No SVG, no ICO, no cropping tool.
- No per-space logos.
- `settings.resetWorkspaceSettings` with `card: "branding"` (REST, command line) still clears the whole branding object, images included, and leaves the old files shared. The screen no longer calls it for the colour.
