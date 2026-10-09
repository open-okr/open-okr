# Guided input fields

**Status: design approved on 8 October 2026. Nothing here is built yet.** Asked for on 8 October 2026: review every input field, and replace free text with guided, validated input where the value has a known format. Every decision in §8 was answered the same day.

This document is the review and the plan. §1 answers the request in one table. §2 is what the review found. §3 and §4 are the design. §5 lists the defects found along the way. §6 is the order of work, §7 the acceptance criteria and §8 the decisions that need a person. The appendix goes field by field.

## 1. The request, and the short answer

| Asked | What the code does today | This plan |
|---|---|---|
| Email fields must be in a valid format | 7 email fields. Most use `type="email"`. The welcome wizard's invite box is not inside a `<form>`, so the browser never checks it | `EmailInput`: checked when the person leaves the field, against the same rule the server uses |
| Phone numbers through intl-tel-input | **No phone field exists.** A member links WhatsApp by sending a code from their phone. The administrator's WhatsApp "phone number id" is Meta's numeric id, not a phone number | Nothing to replace yet. `PhoneInput` is specified (§4.12) and is built when a screen needs a phone number (Q1, decided) |
| Timezone from a dropdown, not free text | 3 free-text boxes: the welcome wizard, Admin > General and the profile. The server accepts anything `Intl` accepts, including `EST`, `+08:00` and `asia/kuala_lumpur`, and stores it exactly as typed | `TimezoneSelect`: a searchable list of every IANA zone with its current offset, with the device's own zone first. The server accepts only names on the list |
| One box per code character, auto-submit when complete | 3 code fields, each a single box: the authenticator code at sign-in, the same code when turning it on, and the backup code. The terminal login code has no field at all and only arrives through a link | `CodeInput`: one cell per character, paste fills every cell, and the form submits once the last cell is filled. Six cells for an authenticator code, two groups of five for a backup code |
| Simple formatting in long text | 34 long-text fields. 16 already store rich text but are typed into a plain textarea, and an edit flattens any formatting. 7 more are prose stored as plain text. 11 should stay plain | The editor gains a compact mode with a toolbar: bold, italic, underline, strike, code, bulleted list, numbered list, link. The 16 move first, with no migration. The 7 move after a migration (Q4, decided). Underline is added to the stored schema (Q3, decided) |

The review found the same problem in nearly every other kind of field. Numbers have no unit and no bounds. Dates have no range. People and spaces are picked from long lists that cannot be searched, or pasted in as raw ids. Lists of domains are typed into one box separated by commas. §4 covers all of them.

## 2. What the review found

Every `<input>`, `<textarea>`, `<select>` and editor in `apps/web` and `packages/ui` was read. Each one was followed to its server action, then to its contract in `packages/core/src/actions`, then to its database column. Hidden inputs, checkboxes, radios, file inputs and selects over a fixed list were counted but not reported.

| Measure | Value |
|---|---|
| Files with form fields | 137 |
| Field tags | 529 |
| Fields reported (text, number, date, time, textarea, editor) | about 270 |
| Member, space, goal and KPI pickers: all native `<select>`, none searchable | about 60 |
| Shared input component in `packages/ui` | **none** |
| Distinct class strings on text inputs and textareas | 99 |
| Uses of Base UI `Field`, `Combobox`, `NumberField` or `Toolbar` | 0, although all four ship in the installed `@base-ui-components/react` 1.0.0-rc.0 |
| Fields where the server has a length limit and the browser does not | more than 60 |

`packages/ui/src/styles/tokens.css` says it already: the field styling is "written inline at every call site, in a dozen variants". Every field below can be guided by a handful of components, so the work is a kit first and screens second.

| Kind of field | Count | Component (§4) |
|---|---|---|
| Title or name, one line | 51 | `TextInput`, with the server's limit and a counter |
| Long prose | 39 | `RichTextField` or `TextArea` (§4.7 says which) |
| Metric value (a key result or KPI value with a unit) | 23 | `MetricInput` |
| Reason for a decision | 21 | `TextArea` that grows with its text |
| Date, date range, date and time, time, duration | 39 | `DateInput`, `DateRangeInput`, `DateTimeInput`, `TimeRangeInput`, `NumberInput` in days |
| Number, weight, percent, money | 15 | `NumberInput` |
| Secret: password, key, token | 12 | `SecretInput` |
| Identifier: provider id, channel id, model id, audit action | 10 | `IdentifierInput`, or a combobox where the values are known |
| Confidence | 7 | `ConfidenceInput` |
| Email | 7 | `EmailInput` |
| URL | 6 | `UrlInput` |
| List: domains, hosts, scopes, terms | 6 | `TokenInput` |
| Search | 6 | `SearchInput` |
| One-time code | 3 | `CodeInput` |
| Timezone | 3 | `TimezoneSelect` |
| Colour | 1 | `ColourInput` |
| Person, space, goal or KPI | 3 pasted ids, about 60 selects | `EntityPicker` |
| Phone | 0 | `PhoneInput`, when a screen needs it |
| Other: year, unit, pulse word, AI prompt, certificate, language | 12 | Per field, in the appendix |

## 3. Principles

1. **The server stays the authority.** A browser check is guidance. Every rule the browser checks is the server's own rule, from one shared function (§4.1), so the two cannot disagree.
2. **Guide while typing, judge on leaving.** A format error appears when the person leaves the field or submits, never on the first keystroke. Coaching verdicts keep their UIUX-PLAN §4 behaviour: they never block typing.
3. **Keep what the browser does well.** Native date and time controls stay. They are accessible, they open the phone's own picker, and they cost no dependency. The kit adds bounds, ranges, the right timezone and a relative label.
4. **No new runtime dependency.** Everything in §4 is built on what is installed: Base UI 1.0.0-rc.0 (`Field`, `Form`, `Combobox`, `Autocomplete`, `NumberField`, `Toolbar`), TipTap 3.31.4 and the browser's `Intl`. The one exception is the phone input, which waits for Q1.
5. **One skin.** One token-based style per density replaces the 99 class strings.
6. **A label, a description and an error, linked.** UIUX-PLAN §7 already requires it. The kit makes it the only way to draw a field.
7. **No practice changes.** No rule, threshold or message in METHOD.md moves. Where a field touches the method (confidence, due dates, titles), the kit reads `packages/method` and the workspace's practice settings.
8. **No new settings.** Nothing here needs configuring, so nothing is added to the TECHNICAL-PLAN §4.14 map.

## 4. The field kit

The kit lives in `packages/ui/src/fields/` and is exported from `@openokr/ui`. Every component:

- wraps Base UI `Field.Root`, `Field.Label`, `Field.Description` and `Field.Error`, so `aria-describedby` and `aria-invalid` are wired in one place;
- takes `name`, `label`, `description`, `required` and `error` (a server message for this field);
- has every string it shows in the English and Bahasa Melayu catalogues.

### 4.1 One rule for the browser and the server

**The problem.** A browser component cannot import `@openokr/core`, because its barrel pulls Postgres code into the bundle ([rich-text-editor.md](rich-text-editor.md) §9). `packages/ui` may depend only on `packages/method` (TECHNICAL-PLAN §1). So today the email, domain, timezone and colour rules exist only on the server.

**The proposal.** A new package, `packages/formats`: pure functions with no dependencies and no I/O, under the same constraint `packages/method` holds. `packages/core` builds its Zod schemas from it, and `packages/ui` calls it in the browser.

| Function | Used by |
|---|---|
| `isEmailAddress(text)` | `EmailInput`, invitations, sign-up |
| `isDomain(text)` | Trusted domains, invitation domains and SSO domains, which follow three different rules today |
| `isHostname(text)` | The AI egress allow-list |
| `isHttpUrl(text, { httpsOnly })` | The AI base URL and the SSO URLs |
| `isLocalDate(text)`, `isClockTime(text)` | Every date and time field |
| `isHexColour(text)`, `isStatusLikeColour(hex)` | Branding, which refuses red, amber and green |
| `normaliseTimezone(name, zones)` | `TimezoneSelect` and `timezoneSchema` |
| `DEVICE_CODE_ALPHABET`, `DEVICE_USER_CODE_GROUPS`, `formatDeviceUserCode` | `CodeInput` for a terminal login code, and the code the server issues |

**The alternative.** Keep the rules in a pure subpath of core, `@openokr/core/formats`, and pass each rule into the kit as a prop, the way the editor already takes `validate`. That adds no package, but every call site has to remember to wire in the check. Q2 chose the new package, so TECHNICAL-PLAN §1's package table and PLAN.md's package list gain `packages/formats` in change 1.

### 4.2 Field errors from the server

Today a refused write goes one of three ways. Its error is swallowed (the operator forms), shown as one message for the whole form, or thrown to the error page (Admin > General). The plan:

- `apps/web/lib/field-errors.ts` turns a `ZodError` or an `OperationError` into `{ field: message }`, with each message taken from the catalogue.
- Every server action returns `{ ok: false, fieldErrors, message }` when a write is refused.
- Base UI `Form` takes that map and shows each message under its own field.

### 4.3 TextInput and TextArea

- One skin per density.
- `maxLength` is always set from the server's limit. A counter appears once 80% of it is used.
- `TextArea` grows with its text: CSS `field-sizing: content` where the browser supports it, and a fixed number of rows where it does not.
- These replace the one-line boxes that accept up to 2000 characters, such as the close reason, the gate override reason and the operator reasons.

### 4.4 EmailInput

| Attribute | Value |
|---|---|
| `type`, `inputMode` | `email` |
| `autoComplete` | `username webauthn` on sign-in, `email` everywhere else |
| `autoCapitalize`, `spellCheck` | `none`, `false` |
| On leaving the field | Trimmed, then checked with `isEmailAddress` |
| Message | "Check the address. It needs a name, an @ and a domain, like priya@northwind.example" |

### 4.5 CodeInput

`CodeInput` is built in `packages/ui`, with no dependency. **One real `<input>` holds the value and the cells are drawn over it.** That way a password manager, the phone's one-time-code autofill and a screen reader each see a single field. A row of six separate inputs breaks all three.

| | Authenticator code | Backup code | Terminal login code |
|---|---|---|---|
| Cells | 6 | 5 + 5 | 4 + 4 |
| Characters | Digits | Letters and digits, case kept | The device alphabet, upper-cased as typed |
| `inputMode` | `numeric` | `text` | `text` |
| `autoComplete` | `one-time-code` | `off` | `off` |
| Submits when full | Yes | Yes | No. The page shows who is asking before anything is approved |
| Where | Sign-in second step, turning on the authenticator in `/account/security` | `/backup-code` | `/account/device` when opened without `?code=` (new: today that page can only say "open the link") |

How it behaves:

- Typing moves to the next cell. Backspace clears the cell and moves back. The arrow keys move between cells.
- Pasting the whole code fills every cell, with or without a hyphen or spaces.
- When the last cell is filled, `onComplete` fires exactly once, and the cells are read-only while the code is checked.
- A wrong code clears the cells, returns focus to the first cell and announces the error.
- Better Auth's own lockout (`assertTwoFactorNotLocked`) still counts every attempt, so submitting automatically gives nobody extra guesses.

### 4.6 TimezoneSelect

`TimezoneSelect` is built on Base UI `Combobox`.

- **The list comes from the server.** The server component reads `Intl.supportedValuesOf("timeZone")`, adds `UTC`, and passes the list as a prop. The browser therefore never offers a name the server would refuse, even where the two runtimes disagree on legacy names such as `Asia/Calcutta` and `Asia/Kolkata`.
- **Each option shows the city, the current offset and the IANA name**, for example `Kuala Lumpur, GMT+8, Asia/Kuala_Lumpur`. Offsets are worked out for today, so daylight saving shows correctly.
- **The search matches** the city, the IANA name, the offset (`+8`, `GMT+8`) and the zone's generic name in the reader's language (`Malaysia Time`, `Pacific Time`), using `Intl.DateTimeFormat` with `timeZoneName: "longGeneric"`.
- Options are grouped by region, which is the part of the name before the `/`.
- The device's own zone is offered in one press, as a "Use this device's zone: Asia/Kuala_Lumpur" button beside the field. A first option in the list would have been the same zone twice, which confuses the list's highlighting. A browser that spells the zone differently from the server's list (`Asia/Kolkata` against `Asia/Calcutta`) is matched to the listed spelling.
- **A stored value that is not on the list**, such as an old `EST`, still shows, marked "not a recognised zone", until somebody picks another. Nothing already stored is rewritten.
- **Server:** `timezoneSchema` and `people.updateOwnProfile` accept only a trimmed name on the list (`isListedTimezone` in `packages/formats`). The list is the runtime's own, which leaves out `UTC`, so `UTC` is added first. `isKnownTimezone` stays, for reading old values; the importer still stores what the source held, and the field shows it as not recognised.
- **The field labels its own input.** Inside Base UI `Field`, the label pointed at the combobox's hidden form input as well, so three elements answered to one label.

It is used on three screens: the welcome wizard, Admin > General and the profile form.

### 4.7 RichTextField: a compact editor with a toolbar

The existing `RichTextEditor` gains a `variant` prop:

| | `compact` (new) | `full` (today's editor, plus the toolbar) |
|---|---|---|
| Toolbar | Bold, italic, underline, strike, inline code, bulleted list, numbered list, link | The same, plus Heading 1, Heading 2, quote and table, the slash menu's own blocks. A block the stored format cannot hold where the caret is (a heading in a list item, anything but text and lists in a table cell) is offered disabled |
| Slash menu | Off | On |
| `@` mentions | Where the caller passes `searchMembers` (comments) | Same |
| Attachments | Where the caller passes `uploadFile` | Same |
| Markdown shortcuts (`**bold**`, `- `, `1. `) | On | On |
| Keyboard | TipTap's own shortcuts (Mod-B, Mod-I, Mod-U and the rest), shown in each button's tooltip, plus Mod-K for a link | Same |

- **The toolbar** is Base UI `Toolbar`: a single Tab stop, arrow keys between buttons, and `aria-pressed` on each button. It stays visible, and stays quiet until the field has focus.
- **Forms keep working.** `RichTextField` writes the document into a hidden input named after the field, so a plain `<form action>` still submits it. The profile bio does this by hand today.
- **Length limits move to the server.** Rich text has no length limit on the server today, so the 1000 and 4000 character caps on these textareas exist only in the browser. `richTextSchema({ maxCharacters })` in core counts characters the way `excerptRichText` reads text, the field shows the same counter, and the caps keep today's numbers. The count is `richTextLength` in `packages/formats`, which the editor's counter, the schema and the excerpt all read through.
- **A cap is held where the field is, not on the action, when an importer writes the same column** (decided 9 October 2026). Both importers create initiatives through `initiatives.create`, and a FlowyTeam project summary has no length limit, so a cap on the action would refuse a source row. The decompose panel's 1000-character cap is held by the panel's own server action instead, and `initiatives.create` stays uncapped.
- **No more flattening.** `asText`, `asDocument` and the one-paragraph wrap in comments are removed. The field loads the stored document as it is, so formatting written through the API or the document editor survives an edit.
**Underline is added** (Q3, decided 8 October 2026; Slack and ClickUp both offer it in comments). It was left out of the stored schema on purpose ([rich-text-editor.md](rich-text-editor.md) §3), so adding it changes that document's §3 and §9 in the same change.

| Where | Change |
|---|---|
| `packages/core/src/rich-text/schema.ts` | `underline` joins the mark allow-list. The schema version stays 1: every stored document is still valid |
| `packages/core/src/rich-text/render.ts` | `underline` renders as `<u>`, so the screen, email and exports show it |
| `excerpt.ts`, chat messages, search, embeddings | Nothing. They read plain text, and an underline has no text of its own |
| `packages/ui/src/rich-text/editor.tsx` | StarterKit's `underline` extension is switched on (it ships in the installed version and is disabled today) |
| `packages/ui/src/styles/rich-text.css` | Links keep their brand colour, and underlined text keeps the text colour, so underlined text never looks like a link. The file arrived with 4c, for the editor and the rendered HTML alike, because the `prose` classes both carried came from a typography plugin the product does not install and lists showed no markers |

**It ships in two steps, as PLAN.md §5.1 asks of anything a newer release writes and an older one reads.** An editor built without the underline mark cannot load a document that carries one: ProseMirror refuses a mark its schema does not know. During a rolling upgrade, or in a browser tab left open across one, an older editor would meet underlined text written by a newer one. So:

1. Change 4a teaches every reader the mark: the allow-list, the renderer and the editor's schema. The editor's mark is defined in `packages/ui/src/rich-text/underline.ts` with no keyboard shortcut and no rule for pasted `<u>`, and the HTML import (`from-html.ts`) does not map `<u>` yet, so nothing writes underline. A local mark rather than TipTap's underline extension, which `packages/ui` does not depend on.
2. Change 4b, a release later, turns on the button and the shortcut.

**Moves now, with no migration:** these already store editor JSON in `jsonb` with a version column.

| Field | Screen | Column |
|---|---|---|
| Mission, vision, strategy, not doing | Annual frame | `annual_frames.*` |
| Stable, declining, business as usual | Cycle phase 2 | `cycle_baseline_health.*` |
| What was cut | Cycle phase 5 | `cycle_capacity_notes.cuts` |
| Narrative: composer, drawer check-in tab, timeline edit | Check-in | `check_ins.narrative` |
| Retrospective | Goal close | `goal_retrospectives.body` |
| What it changes | Decompose into initiatives | `initiatives.description` |
| What the number does not show | Quarterly review | `review_narratives.body` |
| Write-up | Session minutes | `documents.body` (`full` variant) |
| Comment, new and edit | Every comment thread | `comments.body` |

**Moves after a migration (Q4, decided 8 October 2026: all seven):** prose stored as plain `text`.

| Field | Screen | Column today | Becomes | Read as text by |
|---|---|---|---|---|
| Resource or priority shifts | Monthly review | `okr_sessions.shifts` | `shifts_rich` + `shifts_rich_version` | The minutes |
| The decision | Monthly review | `decisions.text` | `text_rich` + `text_rich_version` | The minutes, and the AI minutes draft |
| Management retro answers | Quarterly review | `management_answers.body` | `body_rich` + `body_rich_version` | The minutes |
| Coordinator note | Weekly session | `digests.note` | `note_rich` + `note_rich_version` | The digest, its AI narration, and the channel posts |
| What changed | Quarterly revalidation | `cycle_revalidations.change_note` | `change_note_rich` + version | Nothing else |
| Focus areas | Quarterly revalidation | `cycle_revalidations.focus_note` | `focus_note_rich` + version | Nothing else |
| Private stage note | Quarterly review | A string inside the `okr_sessions.notes` map | The same map, holding editor JSON | The facilitator alone |

The `_rich` names are placeholders. The final names are settled in the change, with `DATABASE.md` and TECHNICAL-PLAN §4 updated in the same change, as they always are.

**How each column moves, over two releases** (PLAN.md §5.1):

| Release | Schema | Writes | Reads |
|---|---|---|---|
| First | Add the `jsonb` column and its version column. The table's row-level security already covers them | Write both: the document, and its plain text from `excerptRichText` into the old column | The new column, falling back to the old one while the backfill runs |
| Between | | The data-change runner wraps every old value as a document, one paragraph per blank-line block (core's `richTextFromPlainText`) | |
| Second | Drop the old `text` column | The document only | The document only |

The private stage note has no column to add. In the first release its readers accept a string or a document, the data-change script turns every string into a document, and the second release accepts documents only.

Everything that reads these fields as text (the digest, its narration, the minutes, channel posts) reads `excerptRichText` of the document, so the AI and the chat channels see the same text they see today. All seven tables are marked "no legacy source" in TECHNICAL-PLAN §7.2, so the importer mapping gains no rows.

**Stays plain on purpose.** Each of these becomes a `TextArea` that grows with its text and has a counter.

| Field | Why plain |
|---|---|
| Contribution statement | AL-1 counts its words |
| Success statement | CY-4 checks it is there; it is one line |
| Strategy note, pack note, dependency note | Short notes in a row of a table |
| Retro note, learning, kudos | One line each. The AI clusters and quotes them as text |
| Space mission | One line, 280 characters |
| Site message | Plain on purpose: `site_messages.body` is shown on every page |
| AI system prompt | It is sent to the model as text |
| SAML certificate | It is a PEM block, not prose |

### 4.8 Numbers: NumberInput, MetricInput, ConfidenceInput, UnitInput

- **`NumberInput`** is built on Base UI `NumberField`. It takes min, max and step from the contract, shows a unit beside the number (`%`, `days`, `US$ per million tokens`), formats the number in the reader's locale, and responds to the arrow keys and its stepper buttons. **An empty field sends nothing, never 0.**
- **`MetricInput`** is a `NumberInput` that shows the key result's or KPI's unit, with the baseline and target as its hint (`from 40 to 75 %`). It is used for all 23 metric values.
- **`ConfidenceInput`** stores 0.0 to 1.0 everywhere, as today. It is shown the way the workspace's `confidence.display` practice setting says (METHOD.md §12, default "x in 10"), with the band label beside the value. It replaces three things: the 0 to 10 number boxes in the drawer and on the goal page, the sliders in the composer, the votes and the timeline that never show their value, and the session dial's own scale.
- **Weight** gets the contract bounds 0 to 100. The method already clamps it to that range (`packages/method/src/scoring.ts`), so the field and the server now agree. An API call sending 150 is refused rather than silently clamped, which is why this needs a changeset.
- **`UnitInput`** is a Base UI `Autocomplete` over the units the workspace already uses, plus a short list from the catalogue (`%`, `people`, `US$`, `days`, `hours`, `points`). Free text is still allowed.
- **KPI thresholds** check the order of green and red as the person types, which is the same check the server makes on save.

### 4.9 Dates and times

- **`DateInput`** is the native `type="date"` control with min and max, and a relative label beside it ("in 12 days", "Q3 2027"), as UIUX-PLAN §2 "Dates" asks.
- **A key result's due date outside its cycle gets a warning, not a refusal.** METHOD.md has no such rule, and adding one would be a practice change.
- **`DateRangeInput`**: the end date's minimum follows the start date. It is used for leave, holidays, initiatives and the audit filter. The server also starts refusing an initiative that ends before it starts, which it accepts today.
- **`DateTimeInput`** is `datetime-local` with the timezone shown beside it. It sends the local value together with the zone, and the server turns the pair into an instant. For workspace screens the zone is the workspace's. For the operator's site messages it is the operator's own browser zone.
- **The audit filter** reads its dates as midnight in the workspace's timezone, not in UTC.
- **`TimeRangeInput`** is for quiet hours. Both times or neither, it shows the saved values, and there is one strict `HH:MM` rule (today there are three rules, and one of them accepts `99:99`).
- **Durations in days** are a `NumberInput` with the unit "days" and a maximum the contract states. Invitation expiry has no maximum today; 365 days is proposed.
- **Server:** dates on tasks and initiatives get the `localDate` format check that key results, sessions and cycles already have.

### 4.10 EntityPicker

UIUX-PLAN §2 already names `EntityPicker`. This plan builds it on Base UI `Combobox`.

- Typing filters the list. A member shows an avatar, a name and a title. A goal shows its short id and its title.
- A stored value that is no longer in the list still shows, the rule today's `MemberPicker` already follows.
- "Nobody" is offered only where the contract allows null.
- Up to 200 entries are filtered in the browser. Above that, the picker asks the server as the person types, through an existing read action.
- It replaces about 60 native selects. It also replaces three fields where an administrator pastes a UUID:
  - an agent's scope binding (`agents.bindScope`, `resourceId`);
  - a budget's owner (`ai.setBudget`, `scopeRef`);
  - a model tier's model (`setTierPolicy`, `modelId`), picked from the models already listed on the same page.

### 4.11 Lists, identifiers, secrets, colour, URLs and search

- **`TokenInput`**: each entry becomes a chip. Entries can be typed or pasted, separated by commas, spaces or new lines, and each chip is checked and marked in place. It is used for:
  - trusted domains, invitation domains and SSO domains, all on `isDomain`;
  - AI egress hosts;
  - SSO scopes;
  - the rhythm word lists.
- **`IdentifierInput`**: a monospace font, no spellcheck, and the server's pattern applied while typing. The SSO provider id lower-cases letters and refuses other characters. The audit filter's "action" and "target type" become comboboxes over the registry's own names.
- **`SecretInput`**: a reveal toggle (the setup screen's `PasswordField`, made shared), `maxLength` from the server, `autoComplete` `off` or `new-password`, and never prefilled. The channel connection fields are labelled per provider:
  - Teams' App ID is not a secret, so it shows as plain text;
  - WhatsApp's app secret and verify token become two fields, instead of one box split on a space.
- **`ColourInput`**: the native colour picker beside the hex box. The refusal of status colours shows as the person picks, not after Save.
- **`UrlInput`**: `type="url"`, http or https only, and https where the server requires it. The server checks the URL's shape too, which it does not do today for SSO or the AI base URL.
- **`SearchInput`**: `type="search"`, a label, and the server's limit. Today the search page throws while rendering once a query passes 500 characters.

### 4.12 PhoneInput: specified, not built

`PhoneInput` is built when a screen needs a phone number, not before. When it is:

| Choice | Why |
|---|---|
| `@intl-tel-input/react/with-utils` (MIT, version 29) | The library that was asked for. This variant bundles its number rules (about 260 KB), so nothing is fetched from a CDN, as the [air-gap checklist](../runbooks/air-gap.md) requires (`no-external-hosts`) |
| Loaded only on the screen that uses it | 260 KB should not be in every page |
| No country lookup by IP address | That would call a third-party service. The default country is none |
| Flags served by the instance | The content security policy allows images from `'self'` only |
| Stored as E.164 (`+60123456789`) | The server checks `^\+[1-9]\d{7,14}$`: E.164's own range, and the one the AI egress redaction already uses |
| Treated as personal data | Export, erasure and AI redaction cover it in the same change |

It is a new runtime dependency, so it is asked again when that screen arrives (CLAUDE.md). Q1 decided to wait until then.

## 5. Defects found along the way

These are wrong today, whatever happens to this plan. **F1 to F4 were confirmed by reading the code.** F5 to F8 come from the review and are confirmed again in their own change. F1 to F6 are each a separate `fix/` change, and the first four should land before the kit. The kit changes in §6 absorb F7 and F8.

| # | Defect | Where | Effect |
|---|---|---|---|
| F1 | `comments.create` and `comments.update` take `body: z.unknown()`. Only the import path checks the rich-text schema | `packages/core/src/actions/comments.ts`, the create and update actions | A body that is not valid editor JSON is stored. CLAUDE.md requires rich text to be validated at the boundary |
| F2 | Saving the profile form clears quiet hours | `apps/web/app/people/[id]/profile-form.tsx` (the time inputs have no saved value) and `apps/web/app/people/actions.ts` (two empty times mean "none") | Changing your timezone deletes the quiet hours you set on `/account/channels`, so nudges can arrive at night |
| F3 | An empty quick check-in records 0 | `apps/web/app/quick-check-in.tsx` and `work-map-actions.ts` (`Number("")` is 0) | Pressing Save on a cleared box writes a real value of 0 |
| F4 | Admin > General re-throws every error that is not an `OperationError`, and returns nothing for one that is | `apps/web/app/admin/general/general-settings-form.tsx` | A mistyped timezone or domain sends the administrator to the error page. A refused save says nothing |
| F5 | Errors are swallowed | The three operator forms, the site message form, and the administrator's edit of a person | The save fails and nothing says so |
| F6 | Instants are read in the wrong zone | Site messages (read in the server's zone), the audit filter (read in UTC) | A message appears at the wrong hour. A filter misses the ends of a day |
| F7 | Server checks are missing or out of step with the browser | Weight has no bounds. Task and initiative dates are unchecked. A budget limit of 0 passes the browser and fails the server. The workspace language accepts any string. SSO URLs are unchecked. Three different domain rules. The quiet-hours rule accepts `99:99`. The browser offers more than the 10 wins the server allows | Values the product cannot use get stored, or a valid-looking form fails |
| F8 | Accessibility faults | Repeated `id="level"` and `id="hours"` in a loop in `admin/support/grant-decision.tsx`. About ten fields are labelled only by a placeholder, or not at all (the coordinator note, the comment box, commitments, the blocker next action, the annual strategies) | The axe scan, and anyone using a screen reader |

## 6. Order of work

Each row is one change: one branch, one commit, one working session. The kit lands before the screens that use it. If a row turns out too big for one session, it splits by screen family (OKR screens, KPI screens, session screens), and that is said before any code is written.

| # | Change | Delivers | Screens |
|---|---|---|---|
| 0 | `fix/*` ×6 | F1 to F6, one each | As listed in §5 |
| 1a | `packages/formats` | The package, with the rules core already enforced moved into it unchanged: email, domain, local date, hex colour, timezone. Done 8 October 2026 | None. Nothing a person sees changes |
| 1b | The base kit | `TextInput` on Base UI `Field`, `EmailInput`, `SecretInput`. Done 9 October 2026 | Sign-in, sign-up, forgot and reset password, setup, the welcome wizard. The auth `Field` helper is rebuilt on `TextInput`, so the backup code page and the single sign-on form take the same skin |
| 1c | The ratchet gate | The gate below, with its first baseline: 336 raw fields in 111 screen files. Done 9 October 2026 | None |
| 2 | `feat/code-input` | `CodeInput`, and the terminal code's alphabet and shape in `packages/formats`. Done 9 October 2026 | Sign-in second step, turning on the authenticator, backup code, terminal login |
| 3 | `feat/timezone-select` | `TimezoneSelect`, the stricter `timezoneSchema`. Done 9 October 2026 | Welcome wizard, Admin > General, profile |
| 4a | `feat/compact-editor` | The `compact` variant, the toolbar, `RichTextField`. Underline step 1: every reader knows the mark, nothing writes it. Done 9 October 2026 | Comments, new and edit, with `@` mentions; the profile bio |
| 4c | Check-in narratives | `RichTextField` on the composer and the timeline's edit, and the compact editor itself in the drawer, which keeps its own state rather than posting a form. The history card shows the narrative as written. Done 9 October 2026 | Check-in composer, the OKR drawer's check-in tab, the timeline's edit |
| 4d | The rest of change 4 | The length limit in `richTextSchema`, with its first capped field. The stored text is shown as written on the goal page and the review stage. Done 9 October 2026 | Goal retrospective, initiative description, review narrative |
| 4b | `feat/underline` | Underline step 2, one release after 4a: the button, Mod-U, pasted `<u>`, and the HTML import's `<u>` | Every editor |
| 5a | The cycle's rich fields | `RichTextField` with `sendUnchanged` for forms that write every field, the 4000-character cap on `workflow.setBaselineHealth` and `workflow.setCapacityNotes`, `workflow.read`'s documents beside its plain text, and `asText` and `asDocument` removed. Done 9 October 2026 | Annual frame ×4, baseline health ×3, capacity cuts |
| 5b | The full editor's toolbar | The compact buttons plus Heading 1, Heading 2, Quote and Table, each offered only where the stored format can hold what it makes. Done 9 October 2026 | The minutes write-up, and every document editor |
| 6 | `feat/number-fields` | `NumberInput`, `MetricInput`, `ConfidenceInput`, `UnitInput`, weight bounds | OKR list, drawer and diagram, goal page, check-in, KPI add, judged-by, suggestion, grid, recovery, trees |
| 7 | `feat/date-time-fields` | `DateInput`, `DateRangeInput`, `DateTimeInput`, `TimeRangeInput`, and the server date checks | Cycle dates, key result due dates, tasks, initiatives, leave, holidays, sessions, site messages, audit, quiet hours |
| 8 | `feat/entity-picker` | `EntityPicker` | About 60 selects and the 3 pasted ids |
| 9 | `feat/list-identifier-fields` | `TokenInput`, `IdentifierInput`, `ColourInput`, `UrlInput`, the channel fields per provider, one domain rule | Admin > General, invitations, SSO, AI, channels, audit, branding, rhythm |
| 10 | `feat/text-limits` | `TextArea`, then `TextInput` and `TextArea` on every remaining title and reason, every label fixed. The ratchet reaches zero | Everything that is left |
| 11 | `feat/rich-session-prose` | First release for five fields: the rich columns, writing both, the readers, the data-change backfill, the editor on screen | Monthly review (shifts, decision), quarterly review (management answers, private stage note), weekly session (coordinator note) |
| 12 | `feat/rich-revalidation-notes` | The same, for the two revalidation notes | Quarterly revalidation |
| 13 | `chore/drop-plain-prose-columns` | Second release, one release after 11 and 12: drop the six old `text` columns, and stop accepting string stage notes | None. Nothing a person sees changes |
| Later | `PhoneInput` | §4.12 | The first screen that needs a phone number |

**Each part of the kit arrives with the change that first uses it.** The length limit of §4.7 waits for 4d, whose initiative description is the first rich field with a cap, and the full editor's toolbar for change 5, which moves the first full-editor field. Change 1 was planned with `TextArea`, `UrlInput` and the server field errors of §4.2, but none of the screens it moved has a textarea, a URL or a server action that reports a field: they talk to Better Auth or keep their own state. So `UrlInput` arrives with change 9, `TextArea` with change 10, and the field errors with the first change whose form is a server action, rather than shipping unused.

**The ratchet gate.** A pass in `pnpm check:boundaries` counts the raw text-like `<input>`, `<textarea>` and `<select>` elements in each screen file of `apps/web`, reading the syntax tree so a comment does not count, and compares the counts with `scripts/raw-fields-baseline.json`. A file's count may go down, never up, and a lower count has to be written into the baseline (`pnpm check:boundaries --update-field-baseline`), so the gain cannot be spent again. Change 10 brings every count to zero and deletes the baseline file, and from then on any raw text field in `apps/web` fails the gate.

**Every change** carries the following:

- a changeset;
- Bahasa Melayu keys;
- unit tests for each component in `packages/ui`;
- an end-to-end happy path for its screens;
- a keyboard path;
- the accessibility scan, which `e2e/s43-accessibility.spec.ts` already runs over every screen.

It also updates any reference mockup that draws a changed field, or records it as a follow-up. Those mockups are 02 cycle workspace, 03 draft coach, 07 weekly session, 08 quarterly review, 12 OKR home and 12b OKR create.

## 7. Acceptance criteria

**Codes**

- **Given** the sign-in second step, **when** a person types or pastes six digits, **then** the code is submitted once without pressing Verify. A wrong code clears the cells, returns focus to the first cell and announces "That code was not right".
- **Given** the backup code page, **when** `abcDE-12345` is pasted, **then** all ten cells fill and the letters keep their case.
- **Given** `/account/device` opened without a code, **when** a person types `ABCD-EFGH`, **then** the page shows what is asking and offers Approve and Deny. Nothing is approved automatically.

**Email and timezone**

- **Given** the invitation form, **when** `priya@northwind` is typed and the person leaves the field, **then** the field shows the format message, linked by `aria-describedby`. The browser does not submit, and the server refuses the same value with the same message key.
- **Given** the profile form, **when** `kuala` or `+8` is typed into Timezone, **then** `Kuala Lumpur, GMT+8, Asia/Kuala_Lumpur` is offered, and choosing it stores `Asia/Kuala_Lumpur`.
- **Given** a write with the timezone `EST` or `asia/kuala_lumpur`, **when** it reaches `people.updateOwnProfile` or `settings.updateWorkspaceGeneral`, **then** it is refused, and the error names the field.
- **Given** a member whose stored timezone is `EST`, **when** the profile opens, **then** the select shows `EST (not a recognised zone)`, and saving another field leaves the timezone as it is.

**Rich text**

- **Given** a check-in narrative with a bold word and a bulleted list, **when** it is edited from the timeline and saved, **then** the bold word and the list are still there.
- **Given** a compact editor, **when** Tab reaches the toolbar, **then** the whole toolbar is one Tab stop, the arrow keys move between buttons, and each button announces whether it is pressed.
- **Given** a baseline health field holding 4000 characters, **when** one more is typed, **then** the counter shows the limit is passed, and the server refuses a 4001-character document.
- **Given** a comment with an underlined word, **when** it is shown on screen, in an email and in an export, **then** the word is underlined in all three, and a link beside it still looks different from it.
- **Given** a release with change 4 and not 4b, **when** a document carrying an underline mark is opened, **then** it loads and shows the underline, and there is no way to add one.
- **Given** a monthly review decision written before change 11, **when** the backfill has run, **then** the decision opens in the editor with the same text in the same paragraphs, and the minutes read it exactly as they did before.
- **Given** change 11 is deployed and change 13 is not, **when** a decision is saved, **then** both the document and its plain text are written, so the previous release, still running during the rollout, reads it correctly.

**Numbers and dates**

- **Given** the quick check-in with its value cleared, **when** Save is pressed, **then** nothing is recorded, and the field says a value is needed.
- **Given** a workspace whose `confidence.display` is "Percent", **when** the composer opens, **then** confidence reads from 0 to 100% and 70% is stored as 0.7. **Given** the default "x in 10", **then** the same value shows as "7 in 10".
- **Given** the initiative form with Starts on 1 October, **when** Ends is opened, **then** dates before 1 October cannot be picked, and the server refuses an end date before the start date.
- **Given** an operator whose browser is in Asia/Kuala_Lumpur, on a server running in UTC, **when** a site message is set to show from 09:00, **then** it starts at 01:00 UTC.
- **Given** quiet hours saved as 22:00 to 07:00, **when** the profile form is saved after changing only the timezone, **then** quiet hours are still 22:00 to 07:00.

**Pickers and the gate**

- **Given** a workspace of 500 members, **when** `pri` is typed into the champion picker, **then** the matching members appear with their titles, and the keyboard alone can choose one.
- **Given** the ratchet baseline, **when** a change adds a raw `<input type="text">` to a file in `apps/web`, **then** `pnpm check:boundaries` fails and names the file.
- **Given** the AI provider is off, **then** every component in §4 works the same. None of them calls AI.

## 8. Decisions for a person

| # | Question | Recommendation | Decided, 8 October 2026 |
|---|---|---|---|
| Q1 | No screen asks for a phone number today. Build `PhoneInput` now, which adds intl-tel-input as a runtime dependency, or wait until a screen needs one? | Wait. Linking WhatsApp by number would also change [channels.md](channels.md) §5 | **Wait** until a screen needs a phone number |
| Q2 | Where do the shared format rules live: a new package `packages/formats`, or a pure subpath of core passed in as props? The first changes TECHNICAL-PLAN §1's package table | `packages/formats`, because then a call site cannot forget the check | **`packages/formats`** |
| Q3 | Add underline to the rich-text allow-list? | No. Underlined text reads as a link on the web | **Add it.** Slack and ClickUp offer it in comments. Shipped in two steps (§4.7) |
| Q4 | Move the 7 plain-text prose fields in §4.7 to rich text? Each one is a two-release migration that touches stored data | Four of them | **All seven** (changes 11 to 13) |
| Q5 | Build `CodeInput` in `packages/ui`, or add shadcn's InputOTP, which brings in the `input-otp` runtime dependency? | Build it. It is small, and it avoids a dependency | **Build it** |

## Appendix: field by field

"Today" is the gap the review found. "Becomes" is the §4 component. Fields that are already right are left out.

### Sign-in, setup and welcome

| Screen | Field | Today | Becomes |
|---|---|---|---|
| Sign-in | Email | `type="email"` | `EmailInput` |
| Sign-in, sign-up, reset, setup | Password | No reveal toggle except on setup, no 128 maximum | `SecretInput`, 12 to 128 characters, with reveal |
| Sign-in, second step | Six-digit code | One box | `CodeInput` 6, submits when full |
| Backup code | Backup code | One box, no format hint | `CodeInput` 5 + 5 |
| Sign-up, setup | Email | `type="email"` | `EmailInput` |
| Sign-up, setup | Name | No limit on either side | `TextInput` |
| Welcome | Workspace name | No limit in the browser, not inside a form | `TextInput`, 200 |
| Welcome | Timezone | Free text | `TimezoneSelect` |
| Welcome | Invite somebody | Not inside a form, so the email format is never checked | `EmailInput` |

### Account

| Screen | Field | Today | Becomes |
|---|---|---|---|
| Security | Code from your app | One box | `CodeInput` 6, submits when full |
| Device | (none) | The code only arrives through the link | `CodeInput` 4 + 4 when opened without a code |
| Your AI keys | Key | No `maxLength` | `SecretInput`, 4096 |
| API tokens | Expires after, in days | Fine | `NumberInput`, "days" |
| Channels | Quiet hours | Filling only one time silently clears both | `TimeRangeInput` |
| Channels | Daily summary time | The label is just "at" | `TimeInput` with a full label |

### Admin

| Screen | Field | Today | Becomes |
|---|---|---|---|
| General | Timezone | Free text. A bad value sends the administrator to the error page | `TimezoneSelect` |
| General | Trusted email domains | A comma-separated list in one box | `TokenInput` (domains) |
| General | Language | Select of en and ms, but the server accepts any string | The server accepts only catalogue languages |
| Invitations | Email ×2 | Fine | `EmailInput` |
| Invitations | Expires in days ×3 | No maximum on either side | `NumberInput`, "days", maximum 365 |
| Invitations | Allowed domains | No domain format check | `TokenInput` (domains) |
| Invitations | Guest of | Select | `EntityPicker` |
| SSO | Provider ID | The server's pattern is not applied in the browser | `IdentifierInput` |
| SSO | Discovery, authorisation, token and user-info URLs | The server never checks their shape | `UrlInput`, https |
| SSO | Scopes | The separator is not stated | `TokenInput` (space-separated) |
| SSO | Email domains | No check at all | `TokenInput` (domains) |
| SSO | Error messages | Not linked to their fields | Base `Field` |
| AI | Base URL | Any string accepted | `UrlInput` |
| AI | Provider key | No `maxLength` | `SecretInput`, 4096 |
| AI | Model id, name | No maximum | `IdentifierInput`, `TextInput` |
| AI | Cost in and cost out, per million | No unit shown | `NumberInput`, "US$ per million tokens" |
| AI | Model per tier | Typed by hand | `EntityPicker` over the models listed on the same page |
| AI governance | Whose budget | Pasted UUID | `EntityPicker` (member or agent) |
| AI governance | Limit | The unit depends on the metric. The browser allows 0, the server refuses it | `NumberInput` with the metric's unit, above 0 |
| AI governance | System prompt | No label | `TextArea`, monospace, labelled (stays plain) |
| AI governance | Hosts an AI request may reach | Free-text list | `TokenInput` (hosts) |
| Agents | Scope binding | Pasted UUID | `EntityPicker` (space, goal or KPI tree) |
| Audit | From, To | Read as UTC, not linked | `DateRangeInput` in the workspace zone |
| Audit | Action, Target type | Free text against a known list | Combobox over the registry's names |
| Audit | Who | Select | `EntityPicker` |
| Branding | Primary colour | Hex box; the status-colour refusal only appears after Save | `ColourInput` |
| Channels | Bot token, signing secret, provider workspace id | One label means four different things. The Teams App ID is masked. WhatsApp's two secrets go in one box | Fields per provider |
| Imports, export | Passphrase ×2 | No maximum, no reveal | `SecretInput` |
| Nudges | Ladder rungs | A raw camelCase key as the label, no unit | `NumberInput`, "days", catalogue labels |
| Rhythm | Thresholds, composite parts | No min, max or unit in the browser | `NumberInput` with the METHOD.md §11 registry's range and unit |
| Rhythm | Word lists | Comma list in one box | `TokenInput` |
| Rhythm | Term labels | Not linked to a label, no maximum | `TextInput`, 40 |
| Roles | Add role | No maximum | `TextInput`, 60 |

### Operator

| Screen | Field | Today | Becomes |
|---|---|---|---|
| Support request, lifecycle, plan | Reason | One line for 500 characters, errors swallowed | `TextArea` with a counter |
| Site message | Shows from, Stops at | No zone; read in the server's zone | `DateTimeInput` |

### People and spaces

| Screen | Field | Today | Becomes |
|---|---|---|---|
| People | Search | No label | `SearchInput` |
| Person (administrator) | Name, title | The save result is discarded | `TextInput` with field errors |
| Person | Manager | Select | `EntityPicker` |
| Profile | Timezone | Free text, cannot be cleared | `TimezoneSelect` |
| Profile | Quiet hours | Saved value not shown, cleared on every save | `TimeRangeInput` |
| Profile | Bio | The editor, with no toolbar | `RichTextField`, compact |
| Leave | From, To, who stands in | Fine | `DateRangeInput`, `EntityPicker` |
| Spaces | Mission | One line for 280 characters | `TextArea` (stays plain) |
| Spaces | Manager, add somebody | Select | `EntityPicker` |
| Space holidays | From, To | Fine | `DateRangeInput` |
| Space settings | Slack and Teams channel id | Typed id, no `maxLength` | `IdentifierInput`, 200 |

### Cycle

| Screen | Field | Today | Becomes |
|---|---|---|---|
| Annual frame | Year, horizon | No `maxLength` | `TextInput`, 40 and 80 |
| Annual frame | Mission, vision, strategy, not doing | Textarea, flattened when read back | `RichTextField` |
| Annual frame | Strategy, what it means in practice | Labelled only by a placeholder | `TextInput` 280, `TextArea` 1000, labelled |
| Annual frame | Why it changes | One line | `TextArea`, 500 |
| Cycle admin, phase 1 | Cycle date, publication deadline, four session dates | No bounds | `DateInput`, warned outside the cycle |
| Phase 1 | Input pack note | No `maxLength` | `TextArea`, 2000 |
| Phase 2 | Stable, declining, business as usual | Textarea; its cap exists only in the browser | `RichTextField`, 4000 |
| Phase 3 | Success statement | One line for 1000 characters | `TextArea` (stays plain) |
| Phase 3, quarterly | What changed, focus areas | Plain textarea | `RichTextField` (change 12) |
| Drafting | Objective and key result titles | Coached only after saving | `TextInput`, 500, with the live coaching the OKR list already has |
| Drafting | Baseline, target, new value | No unit beside it | `MetricInput` |
| Drafting | Unit | Free text | `UnitInput` |
| Drafting | Due date | No bounds | `DateInput`, warned outside the cycle |
| Drafting | What it contributes to | One line for 1000 characters | `TextArea` (stays plain) |
| Phase 5 | What was cut | Textarea | `RichTextField`, 4000 |
| Gates | Override reason | No maximum | `TextArea`, 20 to 2000, with a counter |
| Dependencies | Or name them, what is needed | No maximum | `TextInput` 200, `TextArea` 500 |
| Assists | The ambition | No maximum | `TextArea`, 2000 |
| Every phase | Sponsor, facilitator, owner, champion, reviewer, KPI, strategy, providing space | Select | `EntityPicker` |

### OKRs: list, drawer, diagram and goal page

| Screen | Field | Today | Becomes |
|---|---|---|---|
| All | Objective and key result titles | No maximum | `TextInput`, 500. Live coaching stays |
| All | Value, baseline, target | No unit | `MetricInput` |
| All | Weight | Unbounded on the server. A cleared field posts 0 | `NumberInput`, 0 to 100, bounded on the server too |
| All | Due date | No bounds | `DateInput` |
| All | Unit | Free text | `UnitInput` |
| All | Easing reason, kind reason, why it starts now | No maximum. In the diagram, labelled only by a placeholder | `TextArea`, 500, labelled |
| Drawer | What it contributes to, why it stands alone | Truncated single line | `TextArea`, 1000 |
| Drawer check-in | Confidence ×2 | A 0 to 10 number box | `ConfidenceInput` |
| Drawer check-in | Narrative | Textarea | `RichTextField` |
| Goal page | Why that decision | One line for 2000 characters | `TextArea` |
| Goal page | Retrospective | Textarea | `RichTextField` |
| Goal page | Why the confidence moved | One line, saved as a check-in narrative | `TextArea`, stays one paragraph |
| Decompose | What it changes | Textarea; its cap exists only in the browser | `RichTextField`, 1000 |
| Cycle picker | Search, name | Not `type="search"`, no maximum | `SearchInput`, `TextInput` 120 |
| All | Champion, owner, space, move under, filters | Select | `EntityPicker` |

### Check-in

| Screen | Field | Today | Becomes |
|---|---|---|---|
| Composer | Confidence | A slider that never shows its value | `ConfidenceInput` |
| Composer | New values | The unit only appears in the summary text | `MetricInput` |
| Composer | Narrative | Textarea | `RichTextField` |
| Votes | Your confidence | A slider that never shows its value | `ConfidenceInput` |
| Timeline | Replace the narrative | A one-line input replaces a narrative of several paragraphs | `RichTextField`, loaded with the stored narrative |
| Work Map | Record a value | An empty field records 0 | `MetricInput`; an empty field sends nothing |

### KPIs

| Screen | Field | Today | Becomes |
|---|---|---|---|
| Add, suggestion, tree driver | Title, category name, tree name | No maximum | `TextInput` |
| Add, tree driver | Standing target | No unit, and the form has no unit field | `MetricInput`, and the form gains `UnitInput` |
| Judged by | Six threshold values | No unit; one label is just "to" | `MetricInput`, full labels |
| Suggestion | Healthy at %, watch at % | The order is not shown | `NumberInput`, "%", with the order shown |
| Grid | Cell value | A text box | `MetricInput`, compact |
| Recovery | Task, due, key result, from and to, why now | No maximums, no unit | `TextInput`, `DateInput`, `MetricInput`, `TextArea` |

### Sessions

| Screen | Field | Today | Becomes |
|---|---|---|---|
| Weekly | Coordinator note | No label at all | `RichTextField`, labelled (change 11) |
| Weekly | Next action, blocker next action | Labelled only by a placeholder | `TextInput`, 500, labelled |
| Weekly | What changed this week | No maximum | `TextArea`, 500 |
| Weekly | Commitments, wins | Labelled only by a placeholder. Wins can go past the server's 10 | `TextInput`; stops offering a row at 10 |
| Monthly | Shifts, the decision | Plain textarea | `RichTextField` (change 11) |
| Quarterly | Private stage note | No maximum | `RichTextField`, 4000 (change 11) |
| Quarterly | What the number does not show | Textarea | `RichTextField` |
| Quarterly | Management retro answers | Plain textarea | `RichTextField` (change 11) |
| Quarterly | One word for the cycle | The one-word rule exists only on the server | `TextInput`, one word, 40 |
| Quarterly | Score reason, decision why, root cause detail | No maximum | `TextArea` |
| Quarterly | What we now know, what happens, what they did | No maximum | `TextArea` or `TextInput` |
| Quarterly | By when | No minimum | `DateInput` |
| Minutes | Write-up | Plain textarea, 10 rows | `RichTextField`, full |
| Team retro | A note | No maximum | `TextArea`, 500 (stays plain) |
| Schedule | Time, date and time | No offset sent | `TimeInput`, `DateTimeInput`, zone shown |
| All | Owner, objective, key result, who | Select | `EntityPicker` |

### Work, documents, comments and search

| Screen | Field | Today | Becomes |
|---|---|---|---|
| Initiatives | Starts, Ends | End after start is checked nowhere; no format check on the server | `DateRangeInput` |
| Tasks, board | Due | No format check on the server | `DateInput` |
| Documents | Body | The editor, with no toolbar | `RichTextField`, full |
| Comments | New comment, edit | Textarea, flattened into one paragraph, no label | `RichTextField`, compact, with mentions |
| Copilot | Your question | No maximum | `TextArea`, 4000 |
| Search page | What are you looking for | Throws while rendering past 500 characters | `SearchInput`, 500 |
