# Colour system

The colour specification for OpenOKR. UIUX-PLAN.md §2 is the authority for the rules; this document holds the values, the recipes and the reasoning. Where the two disagree, §2 wins.

Owner: Akmal. Implemented in `packages/ui/src/styles/tokens.css`, checked by `packages/ui/test/tokens-contrast.test.ts`.

---

## How to use this file

Read the rules before writing any interface code. The rules are the point of the system; the hex values are the implementation.

Never write a raw colour in a component. Always go through a token, which in this repository means a Tailwind utility generated from the `@theme` block in `tokens.css`: `bg-surface`, `text-ink-3`, `bg-ok-bg`. If you need a colour that has no token, add the token here and in `tokens.css` first, then use it.

One exemption exists, and it is named in this document: the avatar identity palette.

---

## Rules

**1. Red, amber and green are reserved for status.**

They mean off track, at risk and on track. They appear on health indicators, confidence scores and check-in signals. They never appear in the logo, in navigation, on primary buttons, on links, or as a decorative accent. If a green pixel is on screen, it must mean something is on track.

**2. Progress is not health.**

Progress bars fill with `--brand-strong`, never with a status colour. A key result can be at 90 percent and still be off track if the deadline is tomorrow. Colouring the bar by health merges two independent variables and hides one of them. Show progress with the bar, show health with a chip beside it.

`Bar` has no tone prop. Adding one back is a type error, which is deliberate.

**3. Not every number gets a colour.**

Colour a metric only when the value itself carries good or bad meaning. Objectives at risk is a status, so it takes amber. Check-in rate is an operational fact, so it stays neutral. Average progress is a brand metric, so it takes the brand hue.

**4. Never signal with colour alone.**

Every status colour is paired with a text label or an icon. Red and green are the two ends of this scale and the most common form of colour vision deficiency. A bare coloured dot is not accessible. This repeats UIUX-PLAN.md §2 and §7, which say the same thing.

**5. Brand text uses `--brand-text`, not `--brand`.**

`--brand` is a fill. `--brand-text` is indigo-600 in light and indigo-400 in dark, which keeps a brand-coloured label at AAA on light and safe at 12px on both.

The source specification justified this rule by saying indigo-500 fails AA as body text on white. Measured, indigo-500 on white is 6.29:1, which passes AA — and the specification's own contrast table said so, contradicting its rule. The rule is kept anyway, because the hierarchy it produces is worth having and AAA at small sizes is a real gain. The false reason is not kept.

---

## Primitives

Raw values. Never referenced directly by a component.

### Indigo (brand)

| Stop | Hex | Notes |
|---|---|---|
| indigo-500 | `#4F46E5` | Primary. Logo, primary button, progress fill on light |
| indigo-600 | `#4338CA` | Hover on a brand fill. Brand text on light |
| indigo-700 | `#3730A3` | Pressed. Brand hairline on dark |
| indigo-400 | `#818CF8` | Progress fill, focus indicator and brand text on dark |
| indigo-200 | `#C7D2FE` | The soft halo around a focused control |
| indigo-50 | `#EEF2FF` | Subtle fills, selected rows, tags |
| indigo-950 | `#1E1B4B` | Brand-subtle fill on dark |

### Neutral

A cool grey. It reads as the light, fresh ground the product is drawn on, and
the slight blue in it sits with indigo rather than against it.

| Stop | Hex | Notes |
|---|---|---|
| `#FFFFFF` | | Card surface, light |
| `#F6F8FC` | | App background, light |
| `#EFF3F9` | | Hover rows, nested panels, neutral chips |
| `#E7ECF4` | | Progress track |
| `#E4E9F2` | | Borders and dividers |
| `#CDD6E4` | | Strong border, input outline |
| `#94A3B8` | | Muted text and placeholders. Dark strong-secondary |
| `#617087` | | Secondary text. Two steps below the ramp's `#64748B`, see below |
| `#334155` | | Strong secondary on light, hairlines on dark |
| `#0F172A` | | Primary text on light |
| `#1E293B` | `#1A2332` | Dark hairline and track; dark raised surface |
| `#111827` | `#0B1220` | Dark card surface; dark app background |

### Status

Restricted use. See rule 1.

| Family | Background | Label | Dot |
|---|---|---|---|
| Green (on track) | `#E4F9EC` | `#15803D` | `#22C55E` |
| Amber (at risk) | `#FDF3D5` | `#B45309` | `#F59E0B` |
| Red (off track) | `#FDE9E9` | `#B91C1C` | `#EF4444` |
| Blue (info) | `#E3EEFD` | `#1D4ED8` | `#3B82F6` |

Three stops rather than one, because a pill needs a background, a label and a
dot, and only two of those owe a ratio. **The dots are saturated on purpose.**
They are what makes on-track read as on-track across a dense table before you
have read a word, and rule 4 means they never carry the state alone. See
[Accessibility](#accessibility) for why that is a decision rather than a gap.

On dark the backgrounds deepen and the labels take the dot's saturation. The
dots themselves do not change: they were picked to read on white and on
near-black alike.

| Family | Dark background | Dark label |
|---|---|---|
| Green | `#052E1B` | `#22C55E` |
| Amber | `#3A2A05` | `#F59E0B` |
| Red | `#3A0A0A` | `#F87171` |
| Blue | `#0B2545` | `#60A5FA` |

Red and blue lift one stop further than their dots on dark, because `#EF4444`
and `#3B82F6` as *text* miss 4.5:1 on a hover row.

---

## Semantic tokens

The layer components consume.

### Brand

| Token | Light | Dark | Use |
|---|---|---|---|
| `--brand` | indigo-500 | indigo-500 | Logo, primary button fill, brand surfaces |
| `--brand-600` | indigo-600 | indigo-600 | Hover on a brand fill |
| `--brand-700` | indigo-700 | indigo-700 | Pressed |
| `--brand-strong` | indigo-500 | indigo-400 | Progress fill, focus indicator, active nav marker |
| `--brand-text` | indigo-600 | indigo-400 | Links and brand-coloured text |
| `--brand-weak` | indigo-50 | indigo-950 | Selected rows, tags, empty states |
| `--brand-line` | indigo-200 | indigo-700 | The halo around a focused control |
| `--on-brand` | `#FFFFFF` | `#FFFFFF` | Text on `--brand` or darker |

The ramp splits by job, and the split is what keeps both themes legible:

- **`--brand`, `--brand-600` and `--brand-700` carry white, so they do not move
  between themes.** All three clear 4.5:1 against white on either.
- **`--brand-text` and `--brand-strong` never carry text, so they invert
  freely.** They have to: indigo-500 against a dark progress track is 2.33:1, a
  focus ring nobody can find and a bar that vanishes.

### Text and surface

| Token | Light | Dark | Use |
|---|---|---|---|
| `--ink` | `#0F172A` | `#F1F5F9` | Objective titles, body copy |
| `--ink-2` | `#334155` | `#CBD5E1` | Strong secondary |
| `--ink-3` | `#617087` | `#94A3B8` | Owners, metadata, timestamps |
| `--ink-4` | `#94A3B8` | `#64748B` | Placeholders and disabled labels only |
| `--surface` | `#FFFFFF` | `#111827` | Cards, panels, modals |
| `--bg` | `#F6F8FC` | `#0B1220` | App background behind cards |
| `--raised` | `#EFF3F9` | `#1A2332` | Hover rows, nested panels, neutral chips |
| `--line` | `#E4E9F2` | `#1E293B` | Hairlines, dividers, input outlines |
| `--line-2` | `#CDD6E4` | `#334155` | Hover on inputs |
| `--track` | `#E7ECF4` | `#1E293B` | The unfilled part of a progress bar |

`--ink-4` is the one text token below 4.5:1, and it is the one WCAG 1.4.3
exempts: placeholders and disabled labels. It is never body copy. The test
asserts a ceiling as well as a floor so nobody promotes it by accident.

### Status

| Token | Light | Dark | Use |
|---|---|---|---|
| `--ok` / `--warn` / `--bad` / `--info` | label stop | dark label stop | Label text inside the pill |
| `--ok-bg` / `--warn-bg` / `--bad-bg` / `--info-bg` | background stop | dark background stop | Pill background |
| `--ok-dot` / `--warn-dot` / `--bad-dot` / `--info-dot` | dot stop | same | Dot, solid indicator |


## Component recipes

| Component | Recipe |
|---|---|
| **Primary button** | Fill `--brand`, text `--on-brand`, border `--brand-600`. Hover fills `--brand-600`, active fills `--brand-700`. Disabled drops out of the brand ramp entirely: `--raised` with `--ink-4`, so a dead button reads as dead rather than as a paler live one |
| **Secondary button** | Fill `--surface`, text `--brand-text`, border `--brand-line`. Never a status colour on a button |
| **Progress bar** | Track `--track`, fill `--brand-strong`, fully rounded. The fill does not change with health under any condition. 8px on objectives, 6px on key results |
| **Status pill** | Background `--{state}-bg`, text `--{state}`, optional dot in `--{state}-dot`. Always a text label. Fully rounded |
| **Confidence indicator** | The same three colours as health. High maps to on track, medium to at risk, low to off track. Never a fourth colour for a fourth level; if you need more granularity, put a numeric score in neutral text beside a three-state dot |
| **Metric tile** | Label `--ink-3`, value `--ink`. Override the value colour only when the metric is itself a status. See rule 3 |
| **Objective card** | Surface `--surface`, border `--line`, radius 12px, no shadow |
| **Focus** | A 2px `--brand-strong` outline at 2px offset, optionally haloed with `--brand-line`. The halo is decoration; the outline is the indicator. Visible on every interactive element, including status pills when they are clickable |

### Elevation

A card gets no shadow. It is separated from `--bg` by its border and its lighter surface.

Shadows survive in two places. `--elev-popover` is for a layer floating over arbitrary content, where a border cannot do the job: menus, dialogs, popovers. `--elev-control` and `--elev-brand` are 1px control edges rather than lifts.

Every one is mixed from a token with `color-mix` rather than written as a raw `rgba`, so a workspace that overrides `--brand` gets a glow in its own hue instead of a stranded indigo one.

### The avatar exemption

`packages/ui/src/components/avatar.tsx` holds the one decorative palette in the product, as eight raw hex values. Two constraints shape it:

- no avatar may be red, amber or green (rule 1), and none may be teal or lime, which at 20px read as on-track
- the initials are white, so every fill clears 4.5:1 against white

That leaves the blue-to-pink arc plus one grey: `#6265F0`, `#4338CA`, `#2563EB`, `#0B7EB2`, `#7C3AED`, `#A21CAF`, `#DB2777`, `#6B6A63`.

---

## Accessibility

Every pair below is asserted by `packages/ui/test/tokens-contrast.test.ts`, on both themes, from the token names rather than the hex, so a re-theme is followed rather than pinned.

A table in a document is a claim, and a claim nobody executes rots. Writing the assertions is what found the dark-mode defect below.

**4.5:1 is required for** all text: body copy, secondary text and metadata, status pill labels, status text on a plain surface, brand links, and a primary button's label — each on every surface it can land on, which is the card, the app background and a hover row.

**3:1 is required for** the progress fill against its track and against the surfaces around it, and the focus indicator.

**Nothing is required of** dividers, hairlines and an input's resting outline. They are boundaries between two surfaces, not graphics required to understand content, so WCAG 1.4.11 does not reach them, and holding them to 3:1 would force a border darker than this design wants. A focused input's outline is covered above, and that is the one that has to be seen.

### Why the status dots are exempt

The dots sit between 1.9:1 and 3.8:1 on light, and that is a decision.

WCAG 1.4.11 asks 3:1 of a graphic "required to understand the content". Rule 4 guarantees a dot is never that. A status colour always ships with a text label, the label is what a screen reader announces, and `Chip` renders the dot `aria-hidden`. Nobody depends on the dot to know the state.

What is gained by the exemption is the thing the scale exists for. An amber dark enough to clear 3:1 on its own pill is `#B1852E`, an olive; a green dark enough is a forest green. Side by side in a dense table, a muted scale stops doing the one job it has, which is to be read at a glance before anything else. The saturated dot is not decoration, it is the reason the health column works.

The exemption is conditional, so the condition is tested rather than assumed:

| Guarantee | Where it is asserted |
|---|---|
| The dot is hidden from assistive technology | `test/components.test.tsx`, "the dot is hidden from assistive technology" |
| The chip's accessible name is the label alone | same test |
| The dot is perceptible against its pill | `test/tokens-contrast.test.ts`, "is visible on" |
| The scale has not been quietly desaturated into greys | same file, "stays saturated" |

If a surface ever renders a status colour without a label, the exemption stops applying to it and that surface owes 3:1.

### Measured ratios

| Pair | Ratio | Note |
|---|---|---|
| `#0F172A` on white | 17.85:1 | Body copy, AAA |
| `#617087` on `#F6F8FC` | 4.73:1 | Secondary text on the app background |
| `#94A3B8` on white | 2.56:1 | Below AA on purpose. Muted only |
| `#4338CA` on white | 7.90:1 | Brand link, AAA |
| white on `#4F46E5` | 6.29:1 | Primary button label, both themes |
| `#15803D` on `#E4F9EC` | 6.06:1 | On-track pill label |
| `#B45309` on `#FDF3D5` | 4.87:1 | At-risk pill label |
| `#B91C1C` on `#FDE9E9` | 6.30:1 | Off-track pill label |
| `#1D4ED8` on `#E3EEFD` | 5.72:1 | Info chip label |
| `#4F46E5` on `#E7ECF4` | 5.30:1 | Progress fill against its track, light |
| `#818CF8` on `#1E293B` | 4.90:1 | Progress fill against its track, dark |
| `#22C55E` on `#111827` | 7.79:1 | On-track label, dark |
| `#F87171` on `#3A0A0A` | 6.18:1 | Off-track pill label, dark |

## What changed from the palette as it stood

Two fixes, both measured. Everything else is the original palette, unchanged.

| What | Was | Now | Why |
|---|---|---|---|
| `--ink-3` | `#64748B` | `#617087` | 4.48:1 on the app background and 4.27:1 on a hover row. Secondary text sits on both constantly, and it was the only light-theme value that missed |
| Dark `--ok`, `--warn`, `--bad`, `--info` | not defined | `#22C55E`, `#F59E0B`, `#F87171`, `#60A5FA` | The dark theme overrode the pill *backgrounds* and not the labels, so every status label on every dark screen was a light-theme 700 stop on a 900 background: 2.6:1 to 3.0:1. Nothing was reported because nothing measured it |

Four tokens are new rather than changed, filling gaps the palette had no name for:

| Token | Value | Why it did not exist before |
|---|---|---|
| `--track` | `#E7ECF4` / `#1E293B` | The progress track was a hardcoded `#E7ECF4` inside `Bar` |
| `--brand-text` | `#4338CA` / `#818CF8` | Links reached for `--brand-600`, a hover token, which rule 5 now separates |
| `--brand-strong` | `#4F46E5` / `#818CF8` | Nothing named the brand at a weight that survives a dark background |
| `--on-brand` | `#FFFFFF` | Buttons wrote `text-white`, which is right for a fill that never inverts and wrong the moment one does |

## Deviations from the supplied specification

The specification this document was written from proposed a warm neutral ramp and a muted status scale. Both were tried, rendered and rejected on sight: the warm greys read as dull beside indigo, and the muted status colours lost the glanceability the health column depends on. What was kept is the part that was actually missing — the rules, the recipes, the anti-patterns and the discipline of measuring.

| What | Specification | Here | Why |
|---|---|---|---|
| Neutral ramp | Warm (`#FAFAF9`, `#292826`) | Cool (`#F6F8FC`, `#0F172A`) | The cool ramp reads as the lighter, fresher ground this product wants, and sits with indigo rather than fighting it |
| Status scale | Muted (`#2E9E5B`, `#E0A93B`) | Saturated (`#22C55E`, `#F59E0B`) | See the dot exemption above |
| Token names | `--color-text-primary`, `--color-status-on-track` | `--ink`, `--ok` | Keeps roughly 140 existing component usages working. The semantics are the specification's; only the spelling is this repository's |
| Info | Absent | Its own blue | UIUX-PLAN.md §2 requires an info semantic, and rule 1 rules out borrowing a status hue for it |
| Shadows | None anywhere | None on cards, kept on overlays | A layer floating over arbitrary content needs separation a border cannot give |
| Tailwind scale override | Rename to `brandIndigo` if risky | Not applicable | Tailwind v4 here is CSS-first. There is no `tailwind.config.js` and no default `indigo` key to shadow: every colour utility is generated from the `@theme` block in `tokens.css` |

Rule 5's stated justification was also wrong and is not repeated: the specification says indigo-500 fails AA as body text on white, where it measures 6.29:1 and passes — as the specification's own contrast table said. The rule is kept because the hierarchy it produces is worth having.


## Type pairing

Geist for display and body. One variable file, `apps/web/app/fonts/Geist-Variable.woff2`, covering weights 100 to 900, committed from Vercel's own release under the SIL Open Font License 1.1. `next/font/local` serves it from this origin.

It is committed rather than fetched by `next/font/google`, which self-hosts what the browser downloads but reaches fonts.googleapis.com while the build runs — an air-gapped build has no network. Provenance, version and checksum are in `apps/web/app/fonts/README.md`.

`font-variant-numeric: tabular-nums` on every element rendering a progress percentage, a key result value or a metric tile number. Applied through the `.tabular` class rather than globally, since prose should not go tabular.

## Anti-patterns

Things that will look reasonable in a pull request and are wrong.

- Colouring a progress bar green when it crosses a threshold. Breaks rule 2.
- Using green as a success accent on a confirmation toast. The toast is not an OKR status. Use brand or neutral.
- Using `--brand` as link text. Breaks rule 5. Use `--brand-text`.
- Adding a fourth status colour for a paused or draft state. Use a neutral chip. Paused is the absence of a health signal, not a health signal.
- A coloured dot with no label. Breaks rule 4, and takes the dots' contrast exemption with it.
- Darkening a status colour to make a dot clear 3:1. The dot does not owe 3:1, and the darkening costs the scale the glanceability it exists for. Read the exemption before touching those four values.
- Introducing a teal or lime accent because indigo felt cold. At small sizes both read as on-track.
- Applying a shadow to lift a card. Elevation here is border and background separation.
- Writing `rgba(79, 70, 229, 0.28)` for a brand-tinted shadow. It survives a theme change and a workspace brand override unchanged. Mix from the token.
