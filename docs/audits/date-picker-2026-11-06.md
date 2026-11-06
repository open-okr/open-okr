# Date picker consistency audit — 6 November 2026

## Follow-up implementation

The datetime inconsistency below is resolved: `DateTimeInput` now composes
`DateInput` and `TimeInput`. All date selection uses `DateInput`; the original
combined form value and timezone submission remain unchanged. Date/time bounds
apply to the time field on boundary days. The inventory below records the state
before this change.

## Original result

All date-only fields already share `DateInput` from `@openokr/ui`.
`DateRangeInput` composes two `DateInput` controls; `InlineDate` switches from
display text to `DateInput`. Neither introduces another calendar implementation.

There are nevertheless **two browser picker types**: `DateInput` renders
`type="date"`, while `DateTimeInput` renders `type="datetime-local"` directly.
The latter is used at three source locations. A requirement that every calendar
use one date component would therefore still need the date portion of
`DateTimeInput` to use `DateInput`.

This was a source audit, not a visual browser audit. Native picker appearance
depends on browser and operating system; sharing a React component alone does
not guarantee an identical calendar across browsers.

## Scope and inventory

Inspected 432 production JSX/TSX files under `apps/` and `packages/ui/src/`
with the TypeScript syntax tree, then searched app/UI sources and the lockfile
for date/calendar controls and alternative picker dependencies. Excluded tests,
build output, dependencies and storage. Counts below are source locations, not
the number of controls rendered at runtime (some are inside loops).

| Component | Locations in the app | Implementation |
|---|---:|---|
| `DateInput` | 12 | One native date control in `packages/ui/src/fields/date-input.tsx` |
| `DateRangeInput` | 4 | Two `DateInput` controls with range bounds and validation |
| `InlineDate` | 2 | Shared Goals editor that renders `DateInput` |
| `DateTimeInput` | 3 | Separate native datetime control, with timezone information |

No raw date inputs were found in application screens. No additional date picker
library was found in the dependency lockfile. The existing raw-field boundary
check rejects new raw inputs in `apps/web`; it does not prevent someone adding
an alternative picker component to the UI package.

### Date-only controls

| Screen | Source | Locations |
|---|---|---:|
| Task due date | `apps/web/app/tasks/[id]/controls.tsx` | 1 |
| Board task creation | `apps/web/app/board/page.tsx` | 1 |
| Cycle settings and publication deadline | `apps/web/app/cycle/cycle-admin.tsx` | 2 |
| Cycle drafting | `apps/web/app/cycle/drafting.tsx` | 2 |
| Cycle session dates | `apps/web/app/cycle/phase-forms.tsx` | 1, rendered per session |
| Goal cycle creation | `apps/web/app/goals/cycle-picker.tsx` | 1 |
| Goals inline editor | `apps/web/app/goals/okr-cells.tsx` | 1, shared by table and drawer |
| KPI recovery | `apps/web/app/kpis/recovery/page.tsx` | 1 |
| Session follow-up | `apps/web/app/session/[id]/forward.tsx` | 1 |
| Session process health | `apps/web/app/session/[id]/process-health.tsx` | 1 |

### Date ranges

- Audit filters: `apps/web/app/admin/audit/audit-panel.tsx`.
- Initiatives: `apps/web/app/initiatives/page.tsx`.
- Leave: `apps/web/app/people/[id]/leave-card.tsx`.
- Space holidays: `apps/web/app/spaces/[id]/space-holidays.tsx`.

### Separate datetime picker

- Session scheduling: `apps/web/app/sessions/schedule.tsx:231`.
- Site message start: `apps/web/app/operator/instance/site-message-form.tsx:103`.
- Site message end: `apps/web/app/operator/instance/site-message-form.tsx:111`.

## Recommendations for one date picker

1. Keep `DateInput` as the only implementation of date selection.
2. Keep the `DateTimeInput` public API, but compose its date portion from
   `DateInput` and its time portion from `TimeInput`. Preserve the original form
   field as one `YYYY-MM-DDTHH:MM` value and keep its timezone field/description.
3. Preserve combined datetime `min`/`max`, `required`, disabled state, controlled
   values, clearing and form reset behavior when splitting the control. A date
   bound alone cannot enforce a time bound on the first/last permitted day.
4. Retain `DateRangeInput` and `InlineDate` as wrappers around the same picker.
   Their range validation and inline save behavior serve different workflows.
5. If the requirement also means identical calendar visuals on every browser,
   replace the native picker inside `DateInput` once with a shared calendar.
   That is a design change from `docs/design/guided-inputs.md §4.9`, which
   explicitly specifies native date and datetime controls today.

The initial audit made no component changes. The subsequent implementation
adds regression coverage for combined values, controlled partial input, both
input orders, clearing, reset, disabled/required fields and boundary dates/times.
Native calendar visuals have not been checked across browsers.

## Verification

- Initial audit: existing date and time component tests, 2 files, 19 tests passed.
- `pnpm check:boundaries`: passed; 1,351 files checked, no raw fields in screens.
- Follow-up implementation: date, time, reset and translation tests, 4 files,
  56 tests passed; UI typecheck and targeted Biome checks passed.
- Source scan after implementation: `type="date"` exists only in `DateInput`;
  no `type="datetime-local"` remains in app/UI components.
- Browser follow-up: 17 focused Playwright checks passed in Chromium on the
  actual Sessions and Operator instance pages, using an isolated test database.
  Verified native calendar selection, keyboard navigation, partial input,
  successful saves, reset, invalid date order and stored timezone conversions.
- Desktop and 375px mobile layouts had no horizontal overflow. Focused axe
  scans of the date/time controls reported no violations; final page loads had
  no HTTP errors or uncaught JavaScript exceptions. Test data was isolated and
  the temporary database was removed after verification.
- Safari and Firefox appearance and behavior were not verified.
