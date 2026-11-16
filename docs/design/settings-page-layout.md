# Settings page layout standard

Status: Branding built on it (2026-11-16). Every other admin and account page follows in the rollout below.

Reference: the approved prototype `.audit-screens/settings/settings-prototype.html`, tab "1. Standar". The Branding page was the model: one card, one sticky save bar, three fields across.

## Why

| Problem on today's pages | Standard that fixes it |
|---|---|
| Six Save buttons on one page, labelled "Save", placed inside the card body | One label, "Save changes", one place per save model (§A) |
| No sign that something is unsaved | The save bar says "Not saved yet: ..." (§C) |
| Number fields run the width of the card, or stop at `max-w-sm` and leave a gap | 12-column rule (§E) |
| Settings, instant actions and danger zone mixed with no grouping | Separate cards, group headings when there are more than 4 (§B) |
| Reset to defaults drawn in different variants | Secondary action in the CardHeader, same variant everywhere |

## A. Choosing the save model

| Page | Save model | Pages |
|---|---|---|
| One purpose, fewer than 10 inputs | 1 card and 1 sticky save bar under the card, exactly as Branding | branding, account/ai, connections |
| Several independent cards, saved separately | A save footer inside each card. Not sticky | general, channels, sso |
| A long page where every card edits one settings object | One card per part, one sticky save bar for the whole page | practice, rhythm, nudges |
| Instant actions (revoke, test, delete, change a state) | The action's own button in its card. It is not part of any Save and has no Discard | security, api-tokens, general (state, close) |
| List or tool pages | Header and card style only. No save bar | audit, deleted, invitations, imports, directory |

Rules for all models:

- The label is "Save changes", never "Save".
- Save is pressable unless the form is being sent, so an admin can save again. Discard is off when nothing is unsaved.
- One primary button per card.

## B. Anatomy

| Part | Rule | Classes or component |
|---|---|---|
| Wrapper | One column, 16 px between blocks | `flex flex-col gap-4` |
| Page header | `h1` and one intro sentence. No margin of its own | `text-lg font-bold text-ink`, intro `max-w-prose text-sm text-ink-3` |
| Group heading | Only when the page has more than 4 cards. It groups cards and is not a card | `text-xs font-semibold uppercase text-ink-4` |
| Card header | Title and one sentence. A secondary action (Reset to defaults) sits on the right | `CardHeader`, title `text-sm font-semibold`, description `text-xs text-ink-3` |
| Card body | Fields in order, 16 px apart. Sub-sections are split by a line | `CardBody`, `border-line` |
| Field | A kit component with label and hint. Width comes from the grid (§E), never from its own max width | `col-span-*` |
| Save footer | Status on the left, Discard and Save changes on the right. Last child of the card, under `CardBody` | `SettingsSaveBar mode="footer"` |
| Sticky save bar | Same as the footer, stuck to the bottom of the window | `SettingsSaveBar mode="sticky"` (`sticky bottom-3`) |
| Long list | A list that can grow without bound (sessions) scrolls inside its card at about five rows | `max-h-[296px] overflow-y-auto`, `tabIndex={0}` and an aria-label |
| Danger card | Red title, light red line, the risky button in the body, confirmation by typing | `border-bad/30` |

`SettingsSaveBar` lives in `packages/ui/src/forms/settings-save-bar.tsx`. The page owns the form state. The bar gets the form id, the list of unsaved parts, the saved and error text, and whether the form is being sent. Discard is `type="reset"` and Save is `type="submit" name="intent" value="save"`, both attached with `form={formId}`.

## C. Save bar states

Same in both modes.

| State | Left text | Discard | Save changes |
|---|---|---|---|
| Idle | "No changes." (a page may pass its own idle hint) | Off | On |
| Unsaved | "Not saved yet: Timezone, Language" | On | On |
| Saving | Same as unsaved | Off | Off, "Saving..." with a spinner |
| Saved | "Saved." | Off | On |
| Refused by the server | "Not saved yet: ..." and, as an alert, "Nothing was saved. Fix the field marked above." | On | On |

Instant actions are not in this table. They have their own button and no bar.

## E. The 12-column rule

| Rule | Detail |
|---|---|
| Grid | Every form card body is `grid grid-cols-12 gap-x-6 gap-y-4`. A field fills its span. No `max-w-*` on a field |
| Rows | The spans in one row add up to 12. No empty space at the right |
| 1 field in a row | `col-span-12` (long text, token, checkbox, name) |
| 2 fields | `md:col-span-6` each (timezone and language) |
| 3 fields | `lg:col-span-4` each (colour, logo, favicon; three radio options) |
| 4 fields | `lg:col-span-3` each (short numbers, such as a threshold from 0 to 100) |
| Field and button | 9 and 3, button aligned to the bottom (the confirmation to close a workspace) |
| Narrow screens | Every field is `col-span-12` below `md` (below `lg` for 3 and 4 fields) |
| Odd counts | Split into rows that each add up to 12. Five numbers: 4+4+4, then 6+6. One left over: it takes `col-span-12` |
| Refused fields | A form inside `RefusedFields` adds `[&>ul]:col-span-12` to its grid, because unclaimed refusals render as a `ul` that is a direct grid child |

Sections inside one grid row are separated below `lg` by `border-t border-line pt-5` and have no divider from `lg` up (`lg:border-t-0 lg:pt-0`).

## Rollout

Branding and General are done. The rest wait for their own change, one page at a time. "Proposed" marks a model the prototype does not name.

| Page | Save model | Status |
|---|---|---|
| admin/branding | One card, sticky bar | Done (2026-11-16) |
| admin/general | Footer per card, instant actions for state and close | Done (2026-11-16) |
| admin/channels | Footer per card | Pending |
| admin/sso | Footer per card; quick actions per connection are instant, the connection list scrolls | Done (2026-11-16) |
| admin/practice | One sticky bar for the page | Pending |
| admin/rhythm | One sticky bar for the page | Pending |
| admin/nudges | One sticky bar for the page | Pending |
| admin/connections | One card, sticky bar (per the prototype). The S-37 spec describes a list with End controls, so check before changing | Pending |
| admin/audit | List or tool | Pending |
| admin/deleted | List or tool | Pending |
| admin/invitations | List or tool | Pending |
| admin/imports | List or tool | Pending |
| admin/directory | Instant action (Generate SCIM token in the card footer); the endpoint is a `CopyField` | Done (2026-11-16) |
| admin/agents | Proposed: footer per card, instant actions for run controls | Pending |
| admin/ai | Proposed: footer per card | Pending |
| admin/backups | Proposed: instant actions | Pending |
| admin/plan | Proposed: instant actions | Pending |
| admin/roles | Instant actions; the matrix fits the card at Compact width, the member list scrolls | Done (2026-11-16) |
| admin/support | Instant actions, a scrolling list for past sessions | Done (2026-11-16) |
| admin/webhooks | Proposed: list or tool | Pending |
| account (name, email, delete) | Footer per card (name and picture, profile details), instant actions (picture, appearance, change email), danger card for delete | Done (2026-11-16) |
| account/ai | One card, sticky bar | Pending |
| account/api-tokens | Instant actions | Pending |
| account/channels | Footer per card (Delivery, How often), instant actions for linked accounts | Done (2026-11-16) |
| account/connections | Proposed: instant actions | Pending |
| account/device | Proposed: instant actions | Pending |
| account/security | Instant actions, a scrolling list for sessions | Done (2026-11-16) |
