# The Branding page, revamped

Admin, Branding (S-36) after the logo and favicon landed. Requested by the
product owner on 2 November 2026. Authority: UIUX-PLAN.md §2 (foundations,
colour rules), §9 (quality gates), S-36; `docs/design/colour-system.md`;
[workspace-logo-favicon.md](workspace-logo-favicon.md). Visual guidance from
the `frontend-design` and `ui-ux-pro-max` skills is reference only: the tokens,
Geist and the components in `packages/ui` stay.

## 0. What is wrong today

Seen on 2 November 2026 at 1280 px.

| # | Problem | Why it matters |
|---|---|---|
| 1 | With no colour stored, the native picker shows **black** (`#000000`), while the colour in force is the product's indigo | The one control that should show the brand shows a colour nobody chose |
| 2 | The swatch beside the box is an empty square when nothing is stored | Same: the colour in force is not drawn |
| 3 | The file pickers are the browser's own ("Choose File No file chosen") | Unstyled, unlike every other control, and not a drop target |
| 4 | Three identical cards stacked, each with its own small preview | The three settings make one look, and nowhere shows it whole |
| 5 | A colour shows only after Save | The administrator cannot try one before every member sees it |

## 1. Subject, audience, job

- **Subject:** how this workspace looks to its own members.
- **Audience:** a workspace administrator, once, at setup, and rarely after.
- **Job:** choose a colour, a logo and a tab icon, and be sure of the result before anyone else sees it.

## 2. Plan

**The one memorable thing: a live mirror of the product.** A small, true-to-shape
copy of this workspace's own screen (sidebar brandmark and name, an active nav
row, a primary button, a progress bar, and a browser tab with its icon), drawn
in light and dark side by side. It changes as the administrator types a colour
or picks an image, before anything is saved. Everything else on the page stays
quiet.

| Axis | Choice |
|---|---|
| Colour | The product's tokens only: `surface`, `raised`, `line`, `ink` ramp, `brand` and its stops. The mirror's light and dark frames use the two themes' surface and ink values, so they show both whatever theme the administrator is in. No status colour anywhere (UIUX-PLAN §2 rule 1) |
| Type | Geist at the product's scale: page title 18, section titles 14 semibold, help 12 and 13. No new face, no all-caps labels |
| Radius and elevation | Card borders, no shadow (§2 elevation). The mirror's frames get the control radius, not the card radius, so they read as screens inside a card |
| Motion | None on load. The mirror's brand fill eases 150 ms when the colour changes, off under reduced motion |

**Layout** (revised 2 November 2026: the preview in a 20rem column beside the
settings was too small to read, owner review)

```
≥ 1024 px
┌ Branding ───────────────────────────────────────────────────────────┐
│ How this workspace looks to its members. ...                        │
├ Preview ────────────────────── Browser tab [▪ Name      ] [▪] ──────┤
│ ┌ light ─────────────────────────┐ ┌ dark ──────────────────────────┐│
│ │[■] Name    │ Home      [+ New] │ │[■] Name    │ Home      [+ New] ││
│ │ ▌Home      │ ┌──────────────┐  │ │ ▌Home      │ ┌──────────────┐  ││
│ │ ───        │ │ ▬▬▬▬▬▬───     │  │ │ ───        │ │ ▬▬▬▬▬▬───     │  ││
│ │ ───        │ └──────────────┘  │ │ ───        │ └──────────────┘  ││
│ └────────────────────────────────┘ └────────────────────────────────┘│
├──────────────────────┬──────────────────────┬───────────────────────┤
│ Colour               │ Logo        [AW] Default│ Favicon   [◎] Default│
│ [●] [#4f46e5     ] ■ │ hint                 │ hint                  │
│ Product default ...  │ ┌ ─ drop zone ─ ┐    │ ┌ ─ drop zone ─ ┐     │
│ [Reset to defaults]  │ └ ─ ─ ─ ─ ─ ─ ─ ┘    │ └ ─ ─ ─ ─ ─ ─ ─ ┘     │
├──────────────────────┴──────────────────────┴───────────────────────┤
│ Not saved yet: colour, logo                 [Discard] [Save changes] │  sticky
└──────────────────────────────────────────────────────────────────────┘
< 1024 px: the three settings stack. < 768 px: the two frames stack too.
Order is always preview, settings, Save.
```

Left-aligned throughout. The settings are one card with three columns divided
by the card's own rule, because the three settings are one look (problem 4),
not three cards of the same weight. The mirror spans the content width so each
frame is a readable screen rather than a thumbnail: a sidebar with the
brandmark and the active row, and a content area with the page title, the
primary button and two goal cards with progress bars. Rows without text stand
in for the rest of the navigation, so the mirror needs no new words.

**Review against the brief.** The first draft had three cards with a preview in
each, which is the generic settings-card kit and is what exists today; it is
replaced by one card and one mirror. A palette of preset colours was considered
and dropped: several sit near a status hue and the refusal rule would reject
them. A drag-and-drop zone stays because it is also the file picker's styled,
keyboard-reachable replacement.

## 3. Behaviour

| Element | Rule |
|---|---|
| Colour picker and swatch with nothing stored | Show the colour in force, the product's `#4f46e5`, labelled "Product default". `ColourInput` gains `fallback` (the picker's colour when the box is empty) and `onValueChange` (a whole hex or null) |
| Typing or picking a colour | The mirror's `--brand` is set to it at once. A colour the refusal rule rejects is not mirrored, and the field says why as today. The mirror says "Not saved yet: colour" |
| Saved colour that was darkened | The mirror shows the darkened fill, the one in force, and the field's sentence says so as today |
| Drop zone | A `<label>` wrapping the file input, so a click, Enter or Space opens the picker and the label names it. Dragging a file over it outlines it in `brand`. A dropped or chosen file is checked as today (type, size) |
| Chosen image, not saved | The mirror shows it; the section shows the file name, size, Save and Cancel. "Not saved yet: logo" |
| Saving | **One Save for the whole look**, at the product owner's request on 2 November 2026, after three Save buttons on one card read as three separate settings. The page is one form; "Save changes" and "Discard" sit in a bar under the settings, which sticks to the bottom of the window and says "Not saved yet: …", or how to use it when nothing has changed. Save comes after the fields it saves at every width (revised 2 November 2026; it sat in the preview panel, which put Save above the fields on a phone). Save writes whatever changed: the colour only when it differs from the one the page was drawn with (a hidden `storedColour` travels with it), and each chosen picture. Every check runs before anything is written, so a wrong file leaves the colour unsaved too. Nothing changed answers "Nothing to save." Discard resets the field and forgets both files |
| Reset, Remove | Stay with their own section and act at once: Reset to defaults clears the colour only, Remove takes one picture down |
| Messages | "Saved." or the refusal, in the Save bar |
| Saved state | The mirror shows what is stored, so after Save it shows exactly what members see |

## 4. What stays

Every action, server rule and message key of the colour, logo and favicon
cards. The texts the end-to-end specs read stay: "Branding" as the page
heading, "Empty uses the product's own theme.", "Saved.", the in-force and
refusal sentences, "Reset to defaults", "Choose an image", "Light theme",
"Dark theme", "Browser tab, at 16 and 32 pixels", and the test ids
`brand-swatch`, `branding-logo`, `branding-favicon`,
`branding-logo-preview`, `branding-favicon-preview`.

## 5. Acceptance criteria

**Given** no colour stored, **then** the picker and swatch show `#4f46e5` and
the words "Product default", never black.

**Given** an administrator types `#0e7490`, **then** the mirror's button,
active row and progress bar take that colour before Save, and "Not saved yet:
colour" shows.

**Given** a refused colour, **then** the mirror keeps the colour in force.

**Given** a logo is dropped on the zone, **then** both mirror frames show it
before Save.

**Given** a keyboard user, **then** Tab reaches each drop zone, Enter opens
the file picker, and focus is visible.

**Given** 375 px width, **then** there is no horizontal scroll, the preview
sits above the settings, and Save comes after them.

## 6. Tests

| Test | Kind |
|---|---|
| `ColourInput` `fallback` and `onValueChange` | Unit, `packages/ui/test` |
| The mirror state: typed colour, refused colour ignored, chosen image, saved state | Unit, `apps/web/test/branding-mirror.test.ts` (logic in `apps/web/lib/branding-mirror.ts`) |
| The existing `s36l-branding` and `s36p-branding-images` specs, updated where the preview moved | End to end |
| Axe on `/admin/branding` | Already in `s43-accessibility` |

## 7. What this change does not do

- No new setting, action, migration or message rule.
- No preset palette.
- No change to how the colour is derived or refused.

## 8. The workspace name (4 November 2026)

The owner asked where an administrator renames the workspace, after renaming the only space changed nothing in the header. Only setup (S-34) could set it.

| Part | Rule |
|---|---|
| Where | A **Workspace name** field across the top of the Branding card, above colour, logo and favicon, because the sidebar shows the name beside the logo |
| Mirror | Shows the name as it is typed, with its initials, before it is saved |
| Save | The same one Save button. The name is written through `workspace.rename` only when it differs from the stored one; "Not saved yet: name" lists it like the other parts. Discard restores it |
| Refusal | An emptied name is refused with a sentence; the field is also `required` |
| Not here | A space's name, which is a team's and is renamed under Spaces. The hint says so |
