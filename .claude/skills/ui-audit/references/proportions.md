# Proportion reference

Three columns matter more than the numbers: what is **binding** (an authority
document says so, breaking it is a `VIOLATION`), what is **as-built** (the code
does this today, and it may itself be a violation), and what is a **default**
(a reasonable value nothing in this repository has ruled on, so breaking it is
at most a `RISK`).

Never turn a default into a `VIOLATION`.

## 1. Type

| Item | Status | Value |
|---|---|---|
| Scale | Binding, UIUX-PLAN §2 | 12, 13, 14 (base), 16, 18, 24, 30 |
| Scale, as built | As-built, conflicting | Mockups and `packages/ui` use 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 15, 21, with a 13px body |
| Tabular numerals | Binding, UIUX-PLAN §2 | Every grid and every score display |
| Line height | Default | About 1.5 for body, 1.2 to 1.3 for headings. The larger the size, the tighter |
| Measure | Default | 60 to 75 characters for any paragraph of prose. An objective description spanning a 1920px viewport is unreadable |
| Weight | Default | Two weights per surface at most, plus one for numbers. Rank by size and colour before reaching for a third weight |

## 2. Icon against text

| Item | Status | Value |
|---|---|---|
| Icon set | Binding, UIUX-PLAN §2 | Lucide, with the fixed entity iconography |
| Optical size | Default | Cap height to about 1.25x the font size. 12px text takes a 14px icon, 14px takes 16px, 16px takes 18 or 20px |
| Stroke | Default | 1.5 to 2px, matched to the weight of the text beside it |
| Scaling | Default | Set the icon's size. Never `transform: scale`, which thickens the stroke |
| Status dot | Binding, UIUX-PLAN §7 | 6 to 8px, `aria-hidden`, always paired with a real label |
| Gap to label | Default | 4 to 6px inside a chip, 6 to 8px in a row |

## 3. Controls

| Item | Status | Value |
|---|---|---|
| Button height | As-built | `h-7.5` (30px) default, `h-6.25` (25px) sm, in `packages/ui/src/components/button.tsx` |
| Chip height | As-built | `h-5` (20px), font 12px, padding 8px, radius full |
| Avatar | As-built | 24px default, 20px sm, 30px lg |
| Ladder consistency | Default, and the real test | Whatever the ladder is, a control must not invent a height outside it, and any two controls sharing a row must be the same height |
| Icon-only control | Default | A square at the row's control height |
| Input padding | Default | Horizontal padding about one third of the height. 30px tall takes 10 to 12px |
| Input font on mobile | Default, with teeth | Never below 16px below the 768 breakpoint. Safari on iOS auto-zooms on focus below that, and the layout jumps |
| Touch target | Binding, WCAG 2.2 SC 2.5.8 | 24x24 minimum. 44x44 recommended below 768px |

## 4. Space

| Item | Status | Value |
|---|---|---|
| Grid | Binding, UIUX-PLAN §2 | 4px |
| Grid, as built | As-built, conflicting | Mockups use 7, 9, 14, 18 and 31px |
| Densities | Binding, UIUX-PLAN §2 | Comfortable and compact, per user. Both must be checked |
| Inside a component | Default | 4 or 8px |
| Between related fields | Default | 12 or 16px |
| Between sections | Default | 24 or 32px |
| Card padding | Default | 16px comfortable, 12px compact |
| **Proximity law** | Default, and the most common real defect | The gap from a label to its own field must be **smaller** than the gap from that field to the next label. When they are equal or inverted, a dense form reads as the wrong groups, and no checklist in §9 catches it |
| Nested radius | Default | Inner radius equals outer radius minus the padding between them |
| Elevation | Binding, UIUX-PLAN §2 | A card is separated by border and surface. Shadow only for menus, dialogs and popovers |

## 5. Tables and dense lists

| Item | Status | Value |
|---|---|---|
| Row height | Default | 36 to 40px comfortable, 28 to 32px compact |
| Header | Default | Slightly shorter than a row, and visually distinct without a heavy fill |
| Column width | Default | Driven by content type. Titles stretch, dates and scores stay fixed. Never an equal split |
| Alignment | Default | Numbers right, text left, status chips left in their own column |
| Worst case | Default, and mandatory to test | 500 rows, the longest member name present, a 120 character title. Testing with "Test Objective" proves nothing |
| Virtualised rows | Binding, UIUX-PLAN §2 and §9 | Appear instantly. No entrance animation, no stagger |

## 6. Colour and contrast

| Item | Status | Value |
|---|---|---|
| Text contrast | Binding, UIUX-PLAN §7 | 4.5:1 |
| Interface contrast | Binding, UIUX-PLAN §7 | 3:1, binding the progress fill against its track and the focus indicator |
| Exempt | Binding, UIUX-PLAN §7 | Dividers, hairlines, an input's resting outline, muted text, and status dots under the conditions §7 sets out |
| Status colours | Binding, UIUX-PLAN §2 rule 1 | Red, amber and green mean off track, at risk, on track. Nowhere else |
| Progress | Binding, UIUX-PLAN §2 rule 2 | The bar fills with the brand hue. Health is the chip beside it, never the bar |
| Signal | Binding, UIUX-PLAN §2 rule 4 | Never colour alone |

## 7. Beyond the ideal viewport

| Check | Status | Value |
|---|---|---|
| Reflow | Binding, WCAG 2.2 SC 1.4.10 | 320px wide with no horizontal scroll |
| Zoom | Binding, WCAG 2.2 SC 1.4.4 | 200 percent without loss of content or function |
| Breakpoints | Binding, UIUX-PLAN §3 | 1280 and up full, 768 to 1279 icon sidebar, below 768 bottom tab bar and drawer |
| Themes | Binding, UIUX-PLAN §9 | Light and dark, both verified |
| String expansion | Default | Re-check with strings about 30 percent longer, which is what Bahasa Melayu does to English labels |
