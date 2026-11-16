# Content width: Compact or Full width

A per-member preference for how wide the main content area is. Requested and
approved by the product owner on 16 November 2026, after the settings pages
moved to a 12-column grid ([settings-page-layout.md](settings-page-layout.md))
and a `col-span-12` field became too long on a wide monitor.

## 1. Decisions

| # | Decision | Why |
|---|---|---|
| W1 | A third appearance preference, `width`, beside `theme` and `density` | Density is spacing. Width is a separate choice: somebody may want dense rows on a full-width screen |
| W2 | Values `compact` and `full`. Null means the default, `compact` | The owner chose Compact as the default, so a wide screen gets a readable column without anybody opening a menu |
| W3 | Compact caps the main content at **1152 px**, centred. Full width is today's behaviour | 1152 px holds two `col-span-6` fields of about 550 px each |
| W4 | Applies to every screen inside the app shell. The sidebar, top bar and footer are not capped | One rule. Screens with a canvas are an open question (§6) |
| W5 | Stored per member, like theme and density, and mirrored to the browser before first paint | It follows the person to another machine, and the page does not jump on load |
| W6 | Offered in the account menu and in Your account > Appearance, the same control as theme and density | Where people already look for appearance |

## 2. What the member sees

| Place | Control |
|---|---|
| Account menu (avatar, top right) | A row "Width" with two segments, Compact and Full width, under Density |
| Your account > Appearance | A fourth column. The grid becomes Theme, Language, Density, Width, `lg:col-span-3` each |

Choosing applies at once, like theme and density. Below 1152 px of content
the two values look the same.

## 3. Storage

| Item | Change |
|---|---|
| Migration | `0171_member_content_width.sql`: `alter table workspace_members add column width text check (width in ('compact','full'))`. Nullable, no default, no backfill. Forward-only. The table already has its row-level security policy and soft delete; a new column needs neither again |
| Drizzle | `width: text("width", { enum: ["compact", "full"] })` on `workspaceMembers`, next to `density` |
| Settings map | TECHNICAL-PLAN §4.14 row "Member language, theme, density, width": default adds "compact width" |
| Schema table | TECHNICAL-PLAN §4 `workspace_members` row and DATABASE.md gain `width?` |
| Importer | §7.2: no legacy source. FlowyTeam has no such preference, so imported members keep null, which is Compact |
| Portability and erasure | Follows `theme` and `density`: exported with the member's personal settings, erased with the member |

## 4. Client

| Piece | Change |
|---|---|
| `packages/ui/src/theme/theme-script.ts` | `WIDTH_STORAGE_KEY = "openokr:width"`, type `ContentWidth = "compact" \| "full"`, and the inline script sets `data-width` on `<html>` (default `compact`) before paint |
| `theme-provider.tsx` | `width` and `setWidth`, same pattern as density: state, localStorage, the attribute |
| `apps/web/app/layout.tsx` | `data-width="compact"` beside `data-density`, and the stored member value seeds the provider the same way density does |
| `apps/web/lib/appearance-action.ts` | Accepts `width`, validated as one of the two values, written to the member row. No revalidation, like density |
| `apps/web/lib/appearance.tsx` | The Width segment in both layouts (menu and `layout="grid"`) |
| `apps/web/lib/app-shell.tsx` | The page content, and not the version footer, is wrapped once in `<div data-content-width className="mx-auto w-full flex-1">`, and `:root[data-width="compact"] [data-content-width]` gives it `max-width: 1152px` (one rule in `tokens.css`). The footer, sidebar and top bar keep the full width |
| Catalogue | `appearance.width` "Width", `appearance.widthCompact` "Compact", `appearance.widthFull` "Full width" (en and ms) |

The member read schema (`people.readMember`) and the settings
registry carry `width` as well, the same way they carry `density`.

Nothing here is AI, a nudge or a method rule.

## 5. Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| A1 | A member who never chose a width, on a 1920 px screen | They open any app screen | The content is at most 1152 px wide and centred |
| A2 | The same member | They choose Full width in the account menu | The content fills the main area at once, and the member row stores `full` |
| A3 | A member who chose Full width on another machine | They sign in on a fresh browser | The first paint after the stored value is read is full width, and the choice is shown as selected |
| A4 | Any member | They open Your account > Appearance | Theme, Language, Density and Width sit in one row of four on a wide screen and stack on a phone |
| A5 | A phone | Either value | The screen looks the same |
| A6 | A request with `width: "wide"` | It reaches the appearance action | It is refused at the boundary and nothing is written |

## 6. Open question

| # | Question | Default until answered |
|---|---|---|
| Q1 | Should canvas screens (Work Map, board) ignore Compact and always use the full area? | No exception: the rule applies everywhere, and the owner reviews those screens in the browser |

## 7. Tests

- Unit: theme script sets `data-width`; provider round-trips `width`; appearance action refuses an unknown value.
- DB: migration adds the column, `db:lint` passes.
- End to end: one happy path in an existing appearance spec (choose Full width, reload, still full width).
