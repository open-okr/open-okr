# Adding languages to OpenOKR

Status: **design approved by Agung on 19 November 2026**, every open question (A-1 to A-13) answered as recommended in this document. Rewritten the same day after the review in docs/audits.

Owner: Akmal. Plan: [release 0.10.0](../plans/release-0.10.0.md), rows L1 to L14, decisions L-Q1 to L-Q10.

This design adds Simplified Chinese, Spanish, Arabic, German, Portuguese, French, Italian and Indonesian beside English and Malay. It is written so an engineer can work from task cards cut from section 18. Every claim about today's code cites `file:line` and was checked on `feat/0.10.0-designs` on 19 November 2026. Numbers marked "measured" were measured on that day; numbers marked "published" come from the named source and must be measured again in the build.

Terms used below:

| Term | Meaning |
|---|---|
| Locale | A language code the product can render in, such as `de` or `zh-Hans` |
| Shipped locale | A locale whose catalogue is complete and which a person may choose |
| Catalogue | The JSON file of message keys and their text for one locale |
| Term hole | A placeholder such as `{termObjective}` that the workspace's own word fills (`packages/ui/src/i18n/terms.ts:20-23`) |
| RTL | Right to left, the reading direction of Arabic |
| Slice | A file holding part of a font, used only when a page shows a character in its Unicode range |
| Mixed-version rollout | The minutes during a Kubernetes upgrade when pods of the old and the new release serve the same database |

## 1. What is true today

### 1.1 Settings and resolution

| Area | Today | Where |
|---|---|---|
| Member column | `workspace_members.language`, nullable, null means follow the workspace | `packages/db/migrations/0078_member_language.sql:23-24` |
| Member constraint | Named `workspace_members_language_known`, `language is null or language in ('en', 'ms')` | `0078_member_language.sql:31-33` |
| Drizzle type | `text("language", { enum: ["en", "ms"] })`. A type only; Drizzle does not check it at runtime | `packages/db/src/schema/workspaces.ts:113` |
| Write action | The action is `people.updateOwnProfile` (the review calls it `updateMemberProfile`). Input `language: z.enum(["en", "ms"]).nullable().optional()` | `packages/core/src/actions/people.ts:152`, `:201` |
| Read action | `people.readMember` output `language: z.enum(["en", "ms"]).nullable()` | `people.ts:1097`, `:1125` |
| Output parsing | Action outputs are not parsed at runtime. `define.ts` stores `output` for the contract only | `packages/core/src/actions/define.ts:412` |
| Workspace and instance setting | `languageSchema = z.string().trim().min(2).max(35)`: any string is accepted and stored | `packages/core/src/settings/registry.ts:150`, `packages/core/src/actions/settings.ts:295` |
| Instance default | Setting `instance.language`, bootstrapped from `OPENOKR_DEFAULT_LANGUAGE`, English when unset. No screen sets it | `packages/core/src/secrets/instance-registry.ts:135-139`, `packages/core/src/settings/workspace-defaults.ts:24-37` |
| Signed-in order | Member, then workspace, then `"en"`. The instance step is missing | `packages/core/src/settings/member-language.ts:14-23`, `apps/web/lib/locale.ts:44-56` |
| Signed-out order | Browser, then instance, then `"en"` | `apps/web/lib/locale.ts:70-91` |
| Browser matching | Compares only the primary subtag with a shipped code. `zh-CN` gives `zh`, which never equals `zh-Hans` | `apps/web/lib/accept-language.ts:76-84` |
| Shipped list | `Object.keys(CATALOGUES)` | `apps/web/lib/locale.ts:60` |
| Account picker | Two buttons, English and Bahasa Melayu, no "Follow workspace" button | `apps/web/lib/appearance.tsx:49-52`, `:149-169` |
| Signed-out cookie | None. Existing cookies are `openokr_workspace` and `openokr_tz` | `apps/web/lib/workspace.ts:27`, `packages/formats/src/timezone.ts:59` |
| Cookie notice | None in the product or the docs (searched `docs/` and `apps/web/app` for "cookie notice" and "cookie banner") | |

What an old (0.9.x) pod does with a new code, from the code above (review F2):

| Old pod path | What happens with `ar` stored for a member |
|---|---|
| `resolveMemberLanguage` | `shipped("ar")` is false, so it falls to the workspace language, then `"en"` (`member-language.ts:16-20`). No error |
| Account picker | No button is pressed. Cosmetic |
| Save through `people.updateOwnProfile` with `language: "ar"` | Refused by the input enum (`people.ts:201`). The person sees an error and the value is not saved |
| Mail | `mailLocale("ar")` returns `"en"` (`packages/core/src/mail/words.ts:577-579`) |
| Copilot | `"ar"` is not `"ms"`, so English (`packages/agents/src/drafter.ts:367-368`) |

### 1.2 Catalogues

| Fact | Value | Where |
|---|---|---|
| Keys | 4,989 in `en`, 4,989 in `ms` (measured) | `packages/ui/src/i18n/messages/*.json` |
| Bytes | `en` 373,721 raw, 99,691 gzip -9; `ms` 398,959 raw, 103,599 gzip -9 (measured) | same |
| Loading | `catalogue.ts` imports both JSON files statically into `CATALOGUES` | `packages/ui/src/i18n/catalogue.ts:57-64` |
| Client bundle | `use-translations.tsx` is `"use client"` and imports `CATALOGUES`, so every browser downloads both catalogues | `packages/ui/src/i18n/use-translations.tsx:1-11`, `:51` |
| Server API | `getTranslations()` reads `CATALOGUES[locale]` synchronously | `apps/web/lib/translations.ts:27-45` |
| Readers of `CATALOGUES` | 51 files: 45 test files and 6 source files (`layout.tsx`, `locale.ts`, `translations.ts`, `catalogue.ts`, `use-translations.tsx`, and a comment in `appearance.tsx`) | `git grep -l CATALOGUES` |
| Missing key | `translate` throws | `catalogue.ts:110-116` |
| Key gate | `missingKeys(locale)` fails the build for a locale lacking a key | `catalogue.ts:71-75`, `packages/ui/test/catalogue.test.tsx:19-21` |
| English copies | `SAME_IN_MALAY`, a set of 148 keys whose Malay may equal the English, with reasons as comments | `catalogue.test.tsx:37` to `:220`, `:221-236` |
| Holes | Named holes only, no plural syntax | `catalogue.ts:44-49`, `:87` |
| Messages with a hole | 1,025 (measured) | `en.json` |
| Messages with a term hole | 176 (measured) | `en.json` |
| Count variants | 136 keys end in `One` or `Other` (76 `One`, 60 `Other`, 59 complete pairs), plus 8 `One`/`Many` pairs in `session.detail.stageGap.*`; 17 `One` keys have no sibling and some are not counts (`join.detail.iAlreadyHaveOne`). The review's 144 is close; the exact list comes from the call sites (measured) | `en.json`, call sites such as `apps/web/app/admin/audit/audit-panel.tsx:141` |
| Apostrophes | 137 messages contain `'`; none has `'` directly before `{`, `}`, `#` or `|` (measured) | `en.json` |
| `#` | 2 messages contain `#` (the hex colour hints) | `admin.branding.brandingSettingsForm.sixHexDigits`, `fields.colour.sixHexDigits` |
| Literal braces | 1 message: `What fills {{{placeholder}}}` | `admin.channels.templateMappingForm.whatFills` |
| Fragments | The list is now empty: `FRAGMENTED_MESSAGES = []`. The "213 fragments" in the review comes from a stale comment | `apps/web/test/fragmented-messages.ts:24`, stale comment at `catalogue.ts:51-54` |

### 1.3 Text built on the server

| Text | Today | Where |
|---|---|---|
| Mail words | Own table, `en` and `ms`, 191 keys each (measured), because `packages/core` may not import `packages/ui` | `packages/core/src/mail/words.ts:5-14`, `:16`, `:298` |
| Mail HTML | `lang` only, no `dir` | `packages/core/src/mail/render.ts:465` |
| Account mail | Instance language | `packages/core/src/mail/account.ts:12-13`, `apps/web/lib/account-mail.ts:34` |
| Notification mail | English string builders | `packages/core/src/notifications/templates.ts:34-40` |
| Notification rows | Store `reason` and subject, no rendered text | `packages/db/src/schema/notifications.ts:137-177` |
| Nudge rows | Store `rule_key`, `kind`, subject, channel, no rendered text | `packages/db/src/schema/nudges.ts:71-126` |
| Nudge message | Headline and coach line from `packages/method` in English | `packages/core/src/nudges/message.ts:9-15`, `:30` |
| Rule verdicts on screen | `verdict.prompt` from `packages/method`, English in every locale | `apps/web/app/cycle/rule-verdict.tsx:137` |
| Copilot reply language | `"ms"` gives Malay, anything else English | `packages/agents/src/drafter.ts:367-368`, locale from `packages/core/src/copilot/answer.ts:278` |
| Copilot health words | `en` and `ms` only | `packages/core/src/copilot/read-tools.ts:628` |
| Other AI capabilities | 20 capabilities in the evaluation sets; none receives a locale | `packages/agents/src/evaluation/sets.ts:137-849` |
| Evaluation | Compares fixture output with `isDeepStrictEqual` against a mock provider | `packages/agents/src/evaluation/run.ts:330` |
| List exports | English headers such as "Objective" and "Progress %"; values are stored values such as the health key | `packages/core/src/exports/lists.ts:129-137`, `:71` |
| Queued exports | Built later by the worker for `requested_by_id` | `packages/db/src/schema/exports.ts:29`, `packages/core/src/exports/worker.ts:199-206` |
| Minutes PDF | `@react-pdf/renderer` 4.9.0, default font, English footer `"{page} of {total}"`, no bold | `apps/web/package.json:23`, `apps/web/app/session/[id]/minutes/pdf/render.tsx:101-102` |

### 1.4 The method (packages/method)

| Rule | What depends on language | Where |
|---|---|---|
| OBJ-1 | Word lists: output verbs, movement verbs, why markers, state words; plus end-state shapes. `contains` and `matchesEndStateShape` replace every character outside `a-z0-9` with a space, so accented and non-Latin words never match | `packages/method/src/quality.ts:603-626`, `:532-535`, `packages/method/src/word-lists.ts:238` |
| OBJ-1 "Cannot tell" | Status `pass`, so non-English text usually passes OBJ-1 silently today | `quality.ts:121-123` (condition list) |
| OBJ-2 | Words counted by splitting on whitespace, so a Chinese title is one word. Digits found with `/\d/`, ASCII only | `quality.ts:525-529`, `:587`, `:593`, `:596`, `:635` |
| KR-2 | Counts numbers with `/\d+(?:[.,]\d+)?/`, ASCII only. It reads no words; "from X to Y" is only the condition's label. With Arabic-Indic digits a key result reads "Metric with no numbers", status `warn` | `quality.ts:713-715`, `:825-833`, conditions `:282-296` |
| KR-5 | Word lists: activity nouns, impact words, why markers, output verbs; plus `numbersIn` | `quality.ts:879-899` |
| Word-list parameter | `quality.wordLists` is a §11 parameter: a workspace may add terms | `packages/method/src/thresholds.ts:445`, `docs/specification/METHOD.md:1070` |
| METHOD.md text | Says "OBJ-1, KR-5 and parts of KR-2 match words". The code shows KR-2 matches no words | `METHOD.md:414` |
| Blocking | No word-list check blocks by default. OBJ-1 warns | `METHOD.md:414`, `:550` |
| Score | (passes + 0.5 x warns) / evaluated checks | `METHOD.md:412`, `quality.ts:980` |

### 1.5 Layout, fonts and formats

| Fact | Value | Where |
|---|---|---|
| `<html>` | `lang={locale}`, no `dir` | `apps/web/app/layout.tsx:114-115` |
| Font | Geist variable WOFF2, 69,652 bytes, through `next/font/local` | `apps/web/app/layout.tsx:66-80`, `apps/web/app/fonts/` |
| Air-gap font check | Passes when any `.tsx` under `apps/web/app` imports `next/font/local` and none imports `next/font/google`. It does not look at CSS `@font-face` rules | `scripts/check-air-gap.ts:88-112`, `docs/runbooks/air-gap.md:70` |
| Direction provider | Base UI 1.0.0-rc.0 ships `direction-provider`; the repo uses none | `pnpm-workspace.yaml:79`, `git grep DirectionProvider` empty |
| Rich text editor | TipTap 3.34, which has an editor option `textDirection: 'ltr' | 'rtl' | 'auto'` | `pnpm-workspace.yaml:103`, `@tiptap/core` `index.d.ts:1692` |
| Number input | Base UI `NumberField` with the reader's locale | `packages/ui/src/fields/number-input.tsx:127` |
| Measure format | Fixed comma grouping, chosen to avoid hydration mismatch | `packages/ui/src/lib/format-measure.ts:11-19` |
| Board keys | `ArrowRight` is the next column, `ArrowLeft` the previous, whatever the direction | `apps/web/app/board/board-keys.ts:90` |
| Board announcer | Already reads from the catalogue | `apps/web/app/board/board.tsx:177`, `:308`, `:387` |
| UIUX-PLAN | Says right to left is not required for v1 | `docs/specification/UIUX-PLAN.md:393` |

Physical direction inventory, measured with `git grep` over `apps/web` and `packages/ui/src`, tests excluded:

| Pattern | Uses | Files |
|---|---|---|
| `ml-*`, `mr-*` (and negatives) | 68 | 50 |
| `pl-*`, `pr-*` | 113 | 55 |
| `left-*`, `right-*` | 34 | 24 |
| `text-left`, `text-right` | 72 | 32 |
| `border-l*`, `border-r*` | 31 | 18 |
| `rounded-l/r/tl/tr/bl/br` | 3 | 3 |
| Class total | **321** | |
| `-translate-x-*` | 8 lines | 7 (most are `left-1/2 -translate-x-1/2` centring, which is direction-neutral) |
| `space-x-*` | 0 | 0 |
| Inline style `left:`, `right:`, `marginLeft` and similar | 32 | 10 |
| `"ArrowLeft"` / `"ArrowRight"` | 16 | 6: `board/board-keys.ts`, `goals/okr-diagram.tsx`, `kpis/grid.tsx`, `admin/agents/agent-tabs.tsx`, `admin/ai/provider-tabs.tsx`, `lib/product-tour.tsx` |
| CSS files with `left` or `right` | 29 lines | `globals.css` 7, `agent-face.css` 19, `tokens.css` 3 |

Hard-coded locales are listed in section 12.

### 1.6 Corrections

| # | The previous version or the review said | The code says |
|---|---|---|
| F1 | Constraint `workspace_members_language_check` | `workspace_members_language_known` (`0078_member_language.sql:32`) |
| F2 | An old pod throws on an unknown code | It falls through to the workspace language (table in 1.1) |
| F3 | Term holes are `{term:objective}` | `{termObjective}`, `{termObjectiveLower}` (`terms.ts:20-23`) |
| F4 | `intl-messageformat` has no dependencies and is about 45 kB | 12.2.0 depends on `@formatjs/icu-messageformat-parser` 3.5.23 and `@formatjs/fast-memoize` 3.1.7; 117,447 bytes unpacked (`npm view`). Section 5 has measured bundle sizes |
| F5 | "Measured image footprint" | Nothing was measured then. Section 10 gives measured and published sizes |
| F6 | Structural checks are language-neutral | Not so for OBJ-2 and the digit checks (table in 1.4) |
| F7 | KR-2 uses word lists | It does not; it counts ASCII numbers (1.4) |
| F8 | 4,986 keys | 4,989 |
| Review | `updateMemberProfile` | The action is `people.updateOwnProfile` (`people.ts:152`) |
| Review | 213 fragments | The list is empty (`fragmented-messages.ts:24`) |
| Review | KR-2 reads "from X to Y" | It counts numbers (`quality.ts:825`) |
| Review | `@react-pdf/renderer` is not known to reorder bidirectional text | Its text engine `@react-pdf/textkit` 7.0.1 depends on `bidi-js` and runs bidi reordering (`textkit.js:1153-1157`). Section 11 has the spike result |

## 2. Decisions

"Approved" means Akmal's 19 November answer covers it. "Decided here" means this design takes it and approval of the design approves it. "Needs Akmal" points to section 16.

| # | Decision | Reason | Status |
|---|---|---|---|
| L-D1 | One locale registry, `packages/formats/src/locales.ts`: code, Intl tag, direction, endonym key, font family, `shipped` flag. No messages in it. Every picker, validator, resolver and the mail and AI code read it | `packages/formats` is pure and imported by browser and server. One list stops the `en`/`ms` literals in 1.1 from drifting | Decided here |
| L-D2 | A locale becomes choosable only when its `shipped` flag is true, which the catalogue gate allows only when its catalogue is complete | Lets slices land before every catalogue exists, without `translate` throwing | Decided here |
| L-D3 | Resolution order. Signed in: member, workspace, instance, English. Signed out: cookie, browser, instance, English. A value that is not a shipped locale is skipped at every step | L-Q1 and L-Q3. Adds the missing instance step (review 11) | Approved, detail decided here |
| L-D4 | Conventions per locale as in section 3 | Review 9 | Decided here |
| L-D5 | Catalogues load per locale: one client provider module per locale; a synchronous server API; `CATALOGUES` leaves the client entry | Review 4 | Decided here |
| L-D6 | Plurals by category key chosen with `Intl.PluralRules`, no new dependency | Smallest compatible implementation (L-Q6). L-Q6 said ICU, so the choice is Akmal's | Needs Akmal (A-2) |
| L-D7 | Translation: `pnpm i18n:sync` and a pending ledger keep the build green; `pnpm i18n:translate` uses the product's own AI adapter; a release gate empties the ledger | L-Q7, review 3 | Approved direction, provider needs Akmal (A-3) |
| L-D8 | Migration drops `workspace_members_language_known` by name and adds the ten-code check under the same name | Review 1 | Decided here |
| L-D9 | New writes accept shipped locales only; stored unknown values are kept and skipped | Review 15 | Decided here |
| L-D10 | Automatic activation after old pods drain cannot be proved (section 7.4). Per L-Q2 the fallback comes back to Akmal | A 0.9.x pod emits no signal a 0.10.0 pod could read | Needs Akmal (A-1) |
| L-D11 | Right to left by logical properties, a lint gate, Base UI `DirectionProvider`, `dir="auto"` on user text, arrow keys follow the screen | L-Q4, review 8 | Approved, detail decided here |
| L-D12 | Fonts: vendored pre-sliced WOFF2 files with `unicode-range`; Arabic declared on every page; Chinese declared on `zh-Hans` pages only; no preload | Review 6. Keeps English pages free of CJK bytes | Decided here, A-10 confirms the Chinese fallback |
| L-D13 | PDF stays on `@react-pdf/renderer` if the spike passes; otherwise the fallback in A-12 | Review 7 | Needs Akmal if the spike fails (A-12) |
| L-D14 | Server text lives in `packages/core/src/i18n/messages/<locale>.json`; the message engine moves to `packages/formats` | `packages/core` may not import `packages/ui` (review 12) | Decided here |
| L-D15 | Nudges and notifications keep storing keys and arguments; text is rendered at delivery or read time in the recipient's locale | The rows already store no text (1.3). No schema change | Decided here |
| L-D16 | Export headers are human-facing in the requester's locale; values stay machine values | Review 13 | Needs Akmal (A-11), because plan L14 also names dates and numbers |
| L-D17 | Account mail uses the request's locale when a request exists, the instance language otherwise | Review 12 | Needs Akmal (A-8) |
| L-D18 | The method change is a proposal keyed on the text's script, not the member's locale | Review 5 | Needs Akmal (A-4 to A-7, A-13) |
| L-D19 | Every AI capability that writes text a person reads receives the locale; language names come from the registry | L-Q9 | Approved, detail decided here |
| L-D20 | Signed-out cookie `openokr_locale` as in 8.3 | L-Q3, review 18 | Decided here, A-9 on the notice |

## 3. Locales

| Code | Language | Intl tag used for formatting | Direction | Font | 1234.56 | 12345.6 | Date (short month) | Time | Plural categories (Node 22 ICU) |
|---|---|---|---|---|---|---|---|---|---|
| `en` | English | `en-GB` (kept: today's code uses it, `packages/ui/src/fields/date-format.ts:80`) | ltr | Geist | 1,234.56 | 12,345.6 | 19 Nov 2026 | 14:05 | one, other |
| `ms` | Malay | `ms-MY` | ltr | Geist | 1,234.56 | 12,345.6 | 19 Nov 2026 | 02:05 PTG | other |
| `zh-Hans` | Simplified Chinese | `zh-Hans` | ltr | Geist, then Noto Sans SC | 1,234.56 | 12,345.6 | 2026年11月19日 | 14:05 | other |
| `es` | Spanish | `es` | ltr | Geist | 1234,56 | 12.345,6 | 19 nov 2026 | 14:05 | one, many, other |
| `ar` | Arabic | `ar-u-nu-latn` | rtl | Noto Sans Arabic, then Geist | 1,234.56 | 12,345.6 | 19 نوفمبر 2026 | 02:05 م | zero, one, two, few, many, other |
| `de` | German | `de` | ltr | Geist | 1.234,56 | 12.345,6 | 19. Nov. 2026 | 14:05 | one, other |
| `pt` | Portuguese (Brazil) | `pt` (Intl's `pt` is Brazilian) | ltr | Geist | 1.234,56 | 12.345,6 | 19 de nov. de 2026 | 14:05 | one, many, other |
| `fr` | French | `fr` | ltr | Geist | 1 234,56 (narrow no-break space U+202F) | 12 345,6 | 19 nov. 2026 | 14:05 | one, many, other |
| `it` | Italian | `it` | ltr | Geist | 1234,56 | 12.345,6 | 19 nov 2026 | 14:05 | one, many, other |
| `id` | Indonesian | `id` | ltr | Geist | 1.234,56 | 12.345,6 | 19 Nov 2026 | 14.05 | other |

All values were produced with `Intl` in Node 22.23.5 on 19 November 2026.

Conventions decided:

| Question | Decision | Consequence |
|---|---|---|
| English date order | Keep `en-GB` (day month year, 24-hour) | No change for English readers |
| Arabic digits | Latin digits, forced with `-u-nu-latn` | Server and browser agree even where a runtime's ICU defaults `ar` to Arabic-Indic digits. The method's ASCII digit regexes keep working for text the product formats. Number input still accepts Arabic-Indic digits (next row) |
| Number input | Before parsing, every field normalises Arabic-Indic (U+0660 to U+0669) and Extended Arabic-Indic (U+06F0 to U+06F9) digits to ASCII, U+066B to `.` and U+066C to nothing. In a locale whose decimal separator is `,`, a value with one `.` followed by exactly three digits and no `,` is refused as ambiguous with a translated message | L-Q3's "clear error for ambiguous values" |
| Spanish and Italian grouping | Follow CLDR: four-digit numbers are not grouped (`1234,56`) | Matches each language's style guide. Tests assert it so nobody "fixes" it |
| Time | The locale's own hour cycle | Malay and Arabic show 12-hour time where today some sites force `en-GB` 24-hour (section 12) |
| Plural categories | A catalogue carries every category `Intl.PluralRules` reports in CI's Node. At runtime a category missing from the catalogue falls back to `other` and never throws | An older browser ICU without `many` for Spanish still renders |
| `formatMeasure` grouping | Becomes locale-aware with the locale passed in explicitly | The locale is decided on the server and handed to the client, so both render the same string; no hydration mismatch |

## 4. Catalogue files, loading and bytes

### 4.1 Files

```
packages/ui/src/i18n/messages/<code>.json        one per locale, flat keys, English is the source
packages/ui/src/i18n/same-as-english.ts          map: locale -> key -> reason (replaces SAME_IN_MALAY)
packages/ui/src/i18n/pending.json                ledger: locale -> keys still holding English text
packages/ui/src/i18n/glossary/<code>.json        the method's terms per locale, for translation
packages/core/src/i18n/messages/<code>.json      server text (section 13)
```

### 4.2 Loading

| Surface | Mechanism |
|---|---|
| Server components | `getCatalogue(locale)` in a `server-only` module that imports all ten JSON files. Synchronous, as `apps/web/lib/translations.ts:33` is today. About 4 MB of server memory |
| Client | One client provider module per locale, `packages/ui/src/i18n/providers/<code>.tsx`, each importing only its own JSON. The root layout picks the module for the resolved locale from a map. Next sends a client module only when it is rendered, so an English page references only the `en` provider chunk. The chunk is part of the page's client references and loads before hydration, so no key is ever read before its catalogue exists |
| Pseudo locales | The pseudo and pseudo-rtl catalogues are built from `en` in the test entry only |
| Tests | `CATALOGUES` moves to a subpath export, `@openokr/ui/catalogues`, that is not imported by any client module. The 45 test files change their import line only |
| `appearance.tsx` | Reads codes and endonym keys from the registry, never from a catalogue (`appearance.tsx:40-52` explains why it avoids the catalogue module today) |

Verification in slice S2, before anything else builds on it: a test builds the app and asserts that the client chunks of `/sign-in` with `Accept-Language: en` contain a known `en` value and no `ms`-only value. If Next bundles all provider modules together, the fallback is a per-locale `import()` awaited in a client boundary under a server-rendered first paint, and the slice reports the bytes of both.

### 4.3 Bytes per first load

| Locale | Today | After |
|---|---|---|
| `en` | 772,680 raw, 203,290 gzip -9 (both catalogues) | 374,889 raw, 100,030 gzip -9 |
| `ms` | same as `en` | 400,255 raw, 103,960 gzip -9 |
| `de` | n/a | 446,535 raw, 121,902 gzip -9 (UI); 26,374 raw, 7,639 gzip -9 (server) |
| `fr` | n/a | 459,477 raw, 121,899 gzip -9 (UI); 27,121 raw, 7,624 gzip -9 (server) |
| `it` | n/a | 440,911 raw, 117,166 gzip -9 (UI); 25,823 raw, 7,255 gzip -9 (server) |
| `id` | n/a | 420,715 raw, 109,176 gzip -9 (UI); 24,729 raw, 6,799 gzip -9 (server) |
| `zh-Hans` | n/a | 400,239 raw, 117,944 gzip -9 (UI); 23,763 raw, 7,511 gzip -9 (server) |
| `es` | n/a | 439,281 raw, 117,204 gzip -9 (UI); 25,706 raw, 7,233 gzip -9 (server) |
| `pt` | n/a | 437,359 raw, 116,990 gzip -9 (UI); 25,340 raw, 7,210 gzip -9 (server) |
| `ar` | n/a | 525,880 raw, 125,650 gzip -9 (UI); 30,018 raw, 7,750 gzip -9 (server) |
| All ten if loaded eagerly | n/a | About 3.8 MB raw at today's sizes, which is what per-locale loading avoids |

Gzip -9 figures are measured locally. The server's own compression may differ; slice S2 records the transferred size from the built app.

## 5. Message format

### 5.1 Options

| | A. Plural by category key (recommended) | B. `intl-messageformat`, precompiled | C. `intl-messageformat` at runtime |
|---|---|---|---|
| How | `t("goals.count", { count })` looks up `goals.count.one` / `.other` / `.few` and so on, choosing with `new Intl.PluralRules(intlTag).select(count)`. Named holes and term holes stay as today | Messages written in ICU (`{count, plural, one {# goal} other {# goals}}`), parsed to an AST at build time, formatted at runtime by the parser-free build | Same syntax, parsed in the browser |
| New dependency | None | `intl-messageformat` 12.2.0 (BSD-3-Clause, 117,447 bytes unpacked) at runtime; `@formatjs/icu-messageformat-parser` 3.5.23 (MIT, 260,591 bytes unpacked, depends on `@formatjs/icu-skeleton-parser` 2.1.13, MIT) at build time | Both at runtime |
| Browser bytes | A few hundred bytes of our own code | 7,236 bytes minified, 2,545 gzip -9 (measured with esbuild 0.25, parser aliased to `no-parser.js`) | 33,736 bytes minified, 9,851 gzip -9 (measured) |
| Apostrophes | Plain text; no escaping rule | ICU treats `'` before `{`, `}`, `#`, `|` as a quote. None of the 137 messages with `'` has that shape today; a test keeps it so | Same as B |
| Term holes inside plurals | Each category is a plain message, so `{termObjectiveLower}` works as today | Holes inside branches need the term filler to run on the AST | Same as B |
| Machine translation | Translators and models see whole sentences per category | Models must keep ICU syntax intact; validated by parsing | Same as B |
| Approval | Design approval only | Owner's approval for a new runtime dependency (CLAUDE.md) | Owner's approval |

Recommendation: A. It needs no dependency, keeps `translate` as it is, and the catalogue needs plurals and nothing else ICU offers. If Akmal prefers ICU syntax, B is the version to approve: the parser never ships to the browser.

### 5.2 Migration under A

| Step | Detail |
|---|---|
| Keys | Each count pair becomes one base key with category suffixes: `admin.audit.exportedRowsOne` and `...Other` become `admin.audit.exportedRows.one` and `.other` |
| Call sites | `count === 1 ? t("xOne") : t("xOther")` becomes `t("x", { count })`. About 232 lines in 58 files reference an `Other` or `Many` key (measured, rough) |
| Non-English categories | `ms`, `zh-Hans`, `id` need `other` only; `es`, `pt`, `fr`, `it` need `one`, `many`, `other`; `ar` needs all six |
| Gate | A test fails when a key ends in `One`, `Other` or `Many` and a sibling with another of those suffixes exists, so the old pattern cannot return |
| Holes | Every category of a key must carry the same named holes as English `other`, except `{count}`, which `one` may omit |
| Literal braces | `What fills {{{placeholder}}}` keeps working: under A only `{name}` with a letter first is a hole (`catalogue.ts:87`) |

## 6. Translation workflow

### 6.1 Who runs what, and when

| Step | Command | Who | When | Needs a key |
|---|---|---|---|---|
| Add an English key | Edit `en.json` | Any engineer | In their pull request | No |
| Keep the build green | `pnpm i18n:sync` | The same engineer | Before commit | No |
| What sync does | Copies the English value into the nine other files and records `(locale, key)` in `pending.json`. Removes keys deleted from English everywhere | | | |
| Gate | `pnpm i18n:check`, added to `pnpm check:fast` | CI | Every pull request | No |
| Translate | `pnpm i18n:translate [--locale <code>] [--keys <pattern>]` | Akmal or the release owner | Before a release, or any time | Yes, `OPENOKR_AI_API_KEY` with `--provider` and `--model`, as `pnpm ai:evaluate` takes them |
| Release gate | `pnpm i18n:check --release` fails while `pending.json` is not empty | The release pull request's CI | Each release | No |
| Wording fixes | Edit the locale file by hand and remove the key from `pending.json` if present | Anyone | After release, gradually (L-Q7) | No |

So a key added in English only never breaks a pull request: it renders in English in the other locales until the next translate run. CI never calls a provider, so the air gap and CI secrets are untouched.

### 6.2 `i18n:check`

| Check | Fails when |
|---|---|
| Keys | A shipped locale lacks a key English has, or has a key English lacks |
| Holes | A value's named holes differ from English (generalises `catalogue.test.tsx:395`) |
| Plurals | A base key lacks a category its locale needs |
| English copies | A value equals English and the key is neither in `same-as-english.ts` for that locale nor in `pending.json` |
| Ledger | A `pending.json` entry names a key that no longer exists, or whose value no longer equals English |
| Reasons | A `same-as-english.ts` entry has an empty reason or names a key whose value differs from English |
| Scripts | A `zh-Hans` value with letters has no Han character, or an `ar` value with letters has no Arabic character, unless listed in `same-as-english.ts` |

### 6.3 `i18n:translate`

| Part | Design |
|---|---|
| Where | `packages/agents`, as `pnpm --filter @openokr/agents i18n:translate`, beside `ai:evaluate` and `ai:measure`, so it uses the provider clients already inside `packages/adapters`. No new dependency |
| Input per call | A batch of up to 100 keys: key, English value, the screen path from the key's prefix, the locale's glossary, and the rules below |
| Hole masking | Before sending, every `{name}` and `{termX}` hole is replaced with a numbered token (`⟦1⟧`). After the reply, tokens are restored. A reply that lost, added or duplicated a token is rejected |
| Glossary | `glossary/<code>.json` holds the method's terms (objective, key result, check-in, confidence, champion, reviewer, space, cycle, initiative, KPI, health band names). The first run drafts it; a person may correct it; later runs must use it |
| Validation | Holes equal, categories complete, script check passes, length at most 3 times English. A rejected key stays in `pending.json` and the run reports it |
| Output | Writes the locale file sorted, removes translated keys from `pending.json`, prints tokens used per locale |
| Cost | About 100,000 input tokens per locale for the whole catalogue at today's size (374 KB of English), plus output of similar size. `ai:measure`'s price table turns it into money; nothing runs without the key |

### 6.4 `same-as-english.ts`

`SAME_IN_MALAY` (148 keys, reasons as comments) becomes `SAME_AS_ENGLISH: Record<Locale, Record<string, string>>`, key to reason. The 148 Malay entries move first with their comment as the reason. Endonyms (`locale.name.de` is "Deutsch" in every locale) and product names are listed for every locale.

## 7. Migration and rollout

### 7.1 Schema

Migration, numbered with the next free number when slice S8 lands (0172 is free today; the KPI access design adds migrations too, so check `ls packages/db/migrations` at that moment):

```sql
-- Ten codes from the locale registry (docs/design/languages.md §7).
-- No "if exists": a wrong name must fail the migration, not pass silently.
alter table workspace_members
  drop constraint workspace_members_language_known;

alter table workspace_members
  add constraint workspace_members_language_known
    check (language is null or language in
      ('en', 'ms', 'zh-Hans', 'es', 'ar', 'de', 'pt', 'fr', 'it', 'id'))
    not valid;

alter table workspace_members
  validate constraint workspace_members_language_known;
```

| Item | Detail |
|---|---|
| Lock | `not valid` then `validate` keeps the exclusive lock to the catalogue change; validation takes a weaker lock |
| Row-level security | No new table. `workspace_members` keeps its policy |
| Drizzle | `schema/workspaces.ts:113` takes its enum from the registry's ten codes |
| Data change | None. Every stored value is null, `en` or `ms` |
| Two-release rule | Nothing is removed or renamed (PLAN §5.1) |
| Importer | `workspace_members.language` has no FlowyTeam source today; the mapping table row stays as it is, checked in the slice |

### 7.2 Actions and contract

| Item | Change |
|---|---|
| `people.updateOwnProfile` input (`people.ts:201`) | Enum of shipped locales from the registry, plus null |
| `people.readMember` output (`people.ts:1097`) | Enum of all ten codes, nullable, which is what the database can hold |
| Workspace and instance language (`registry.ts:150`, `settings.ts:295`) | New writes refined to shipped locales. A stored value outside the list is preserved, shown in the picker as "Not available: `xx`", and skipped by resolution |
| Contract | `pnpm gen:contract` regenerates `contract/openapi.json` (enums at lines 2064 and 3743 today) and `contract/mcp.json` (line 214); `contract/cli.json` carries the field without an enum. `pnpm check:contract` must be green |
| Changeset | Written in the same commit: a running instance accepts new codes |

### 7.3 The risk, restated from F2

| Window | What can go wrong | Severity |
|---|---|---|
| A 0.10.0 pod writes before the migration | Constraint violation, save fails | Excluded on Helm: the migration job is a `pre-install,pre-upgrade` hook (`deploy/helm/templates/migration-job.yaml:16`). On Compose the migrator runs before the app |
| A member saves `ar` and the request lands on a 0.9.x pod | The old input enum refuses it; the person sees an error and tries again | Low, visible, no data loss |
| A member with `ar` is served by a 0.9.x pod | They see the workspace language for that request | Low, cosmetic, ends with the rollout |
| An old pod sends mail or a copilot answer to that member | English | Low, ends with the rollout |

### 7.4 Activation

L-Q2 asked for automatic activation once old pods are out, with a test, or a compatibility step back to Akmal. Automatic activation cannot be proved: a 0.10.0 pod could only know that old pods are gone if old pods announced themselves, and 0.9.x has no heartbeat or version stamp (`git grep heartbeat` finds only board presence). A timer is a guess, not a proof. So the fallback applies, and A-1 asks Akmal to choose:

| Option | What ships | Test |
|---|---|---|
| A (recommended) | New codes are writable from the first 0.10.0 pod. The degraded window in 7.3 is accepted and named in the release notes | Mixed-version test (AC-12): a 0.9.x build and a 0.10.0 build against one migrated database; an `ar` member is read, rendered and mailed by the old build without an error; a save of `ar` to the old build is refused with a validation error and nothing is written; the same save to the new build succeeds |
| B | 0.10.0 ships the migration, the registry and tolerant reads, with new member codes refused. The next release enables them. 0.10.0 also adds a process version stamp so later releases can gate automatically | The same test, plus a test that 0.10.0 refuses a new member code |

Workspace and instance defaults are not part of the risk: old pods already accept any string there (`registry.ts:150`) and resolve unknown values to English.

## 8. Resolution order

### 8.1 Order

| Context | Order | Change from today |
|---|---|---|
| Signed in, in a workspace | Member, workspace, instance, English | Adds the instance step in `resolveMemberLanguage` (`member-language.ts:20`, `:22`) |
| Signed out, or no workspace yet | Cookie, browser, instance, English | Adds the cookie step in `visitorLocale` (`locale.ts:70`) |
| Any step | A value that is not a shipped locale is skipped, never an error | `resolveMemberLanguage` returns the registry type, not `"en" | "ms"` |

AC-2 uses a `de` instance so the instance step and the English step give different answers.

### 8.2 Browser matching

`browserLocale` (`accept-language.ts:72`) changes from "primary subtag equals a code" to this table, applied to each range in weight order:

| Range (lower-cased) | Result |
|---|---|
| Exact match with a shipped code, compared case-insensitively (`zh-hans`) | That code |
| `zh`, `zh-cn`, `zh-sg`, `zh-my`, `zh-hans`, `zh-hans-*` | `zh-Hans` |
| `zh-tw`, `zh-hk`, `zh-mo`, `zh-hant`, `zh-hant-*` | No match; try the next range |
| `in` (the old code for Indonesian) | `id` |
| Any other range | Its primary subtag if that is a shipped code (`pt-br` and `pt-pt` give `pt`, `es-419` gives `es`, `ar-eg` gives `ar`) |
| `*` | No match, as today |

### 8.3 The signed-out cookie

| Attribute | Value |
|---|---|
| Name | `openokr_locale` |
| Value | One shipped code. Anything else is ignored |
| Set by | A server action behind the signed-out switcher on S-35, with `cookies().set`, as `apps/web/app/workspace-switcher.tsx:46` does |
| Lifetime | One year, the same as `openokr_tz` |
| Attributes | `Path=/`, `SameSite=Lax`, `HttpOnly` (only the server reads it), `Secure` on https |
| Set also by | `setAppearance` when a member changes their language (topbar or account page); "Follow workspace" deletes it, so the next sign-in page matches the app |
| Signed in | Not consulted for rendering. The member, workspace and instance decide |
| Carried into the member | An Apply on the sign-in picker also sets the session cookie `openokr_locale_chosen`. The next successful sign-in (password, code, passkey, backup code, or SSO through `/sign-in/continue`) saves the language on the member and deletes that cookie (owner decision 2026-11-23) |
| Notice | The product has no cookie notice. The cookie stores a choice the person made, carries nothing about them and is not shared. Recommendation: list the three cookies in `docs/admin/security.md`, no banner (A-9) |

## 9. Right to left

| Item | Design |
|---|---|
| Root | `<html lang={locale} dir={direction(locale)}>` in `layout.tsx:114` |
| Base UI | Wrap the app in Base UI's `DirectionProvider` with the same direction, so menus, sliders, tabs and popovers place and key themselves correctly |
| Classes | Replace the 321 physical class uses in 1.5 with logical ones: `ms-`/`me-`, `ps-`/`pe-`, `start-`/`end-`, `text-start`/`text-end`, `border-s`/`border-e`, `rounded-s`/`rounded-e`. `left-1/2 -translate-x-1/2` centring stays |
| Inline styles and CSS | The 32 inline style sites and the 29 CSS lines move to `inset-inline-*`, `margin-inline-*` and similar |
| Lint gate | `scripts/check-direction.ts`, run by `pnpm check:fast`: fails on a physical class or style in `apps/web` and `packages/ui/src`. It starts with a debt list of today's sites that may only shrink, like `fragmented-messages.ts` did, and an allow-list for direction-neutral patterns marked with a `direction-neutral:` comment |
| Icons | Icons that point along the reading direction (back, forward, chevrons in breadcrumbs, collapse) get `rtl:-scale-x-100`. Others do not |
| Arrow keys | Keys follow what the person sees. In RTL the board's first column is on the right, so `ArrowLeft` moves to the next column in reading order and `ArrowRight` to the previous one. `board-keys.ts:90` takes the direction. The same rule for the 6 files in 1.5. Base UI tabs follow it through `DirectionProvider` |
| Charts | Progress bars fill from the inline start. Time axes run in reading direction. Value axes do not mirror |
| User text | `dir="auto"` on `TextInput` and `TextArea` in `packages/ui`, on every element that renders a user-written title, name or comment, and `textDirection: 'auto'` on the TipTap editor. If TipTap writes a `dir` attribute into stored JSON, the rich-text validator in `packages/core` must accept it; the slice's test decides |
| Ltr islands | URLs, email addresses, codes, keys and identifiers get `dir="ltr"` |
| Board announcer | Already from the catalogue (`board.tsx:177`, `:308`, `:387`). Its sentences name columns, not directions; no catalogue message today says "left" or "right" in a directional sense (searched) |
| Mail | `<html lang dir>` in `packages/core/src/mail/render.ts:465`; table cells use `text-align: start` |
| Pseudo-rtl | A pseudo locale `pseudo-rtl` wraps each English message in U+202E ... U+202C and sets `dir="rtl"`, so the layout can be checked before the Arabic catalogue exists |
| Accessibility | `e2e/s43-accessibility.spec.ts` runs a second pass with an `ar` member once `ar` ships; `s43b` keyboard flows run in `ar` too |
| Visual review | Every screen at desktop and phone width in `ar`, recorded in the release checks (plan §5) |
| Spec | `UIUX-PLAN.md:393` ("Right-to-left is not required for v1") is updated in slice S10 |

## 10. Fonts

### 10.1 Source

Vendored files, committed like Geist, not an npm dependency. Taken from Fontsource 5.3 packages, which repackage Google Fonts' own slicing under SIL Open Font License 1.1. No slicing tool is needed. If Akmal prefers slicing from the upstream Noto files, that needs a build tool (`fonttools`, Python, MIT; or `subset-font` 2.9.0, npm, BSD-3-Clause, depends on `harfbuzzjs`), which is a dependency question.

| File set | Source | Size |
|---|---|---|
| Noto Sans SC, 97 Han slices, variable weight, WOFF2 | `@fontsource-variable/noto-sans-sc` 5.3.1 | 4,448,664 bytes total, largest slice 76,324 (measured) |
| Its Latin, Latin Extended, Cyrillic and Vietnamese slices | same | Not vendored: Geist covers Latin |
| Noto Sans SC `@font-face` CSS for 101 slices | same, `wght.css` | 101,698 raw, 31,070 gzip -9 (measured); about 97 percent of that for the Han slices |
| Noto Sans Arabic, Arabic slice, variable weight, WOFF2 | `@fontsource-variable/noto-sans-arabic` 5.3.0 | 165,960 bytes (measured) |
| PDF: Noto Sans SC Regular, subset OTF | github.com/notofonts/noto-cjk, `Sans/SubsetOTF/SC/NotoSansSC-Regular.otf` | 8,331,336 bytes (published) |
| PDF: Noto Sans Arabic Regular, unhinted TTF | github.com/notofonts/notofonts.github.io, `fonts/NotoSansArabic/unhinted/ttf/` | 142,140 bytes (published); hinted 234,892 |
| Not chosen: Noto Sans SC variable TTF | github.com/google/fonts, `ofl/notosanssc/NotoSansSC[wght].ttf` | 17,772,300 bytes (published) |

The minutes PDF uses one weight (`render.tsx` sets no `fontWeight`), so Regular is enough.

### 10.2 Loading

| Rule | Design |
|---|---|
| Arabic | One `@font-face` rule with the Arabic `unicode-range` on every page. A page with no Arabic character downloads nothing; an English page showing an Arabic name downloads the 165,960-byte slice |
| Chinese | The SC stylesheet is linked only when the locale is `zh-Hans`. On other locales Chinese user text falls back to the system's CJK font (PingFang, Microsoft YaHei, Noto CJK on Android). Declaring SC everywhere would add 31 KB gzip of CSS to every English page (A-10) |
| Preload | None. `unicode-range` decides what downloads |
| Stack | `--font-sans`: Geist, then Noto Sans Arabic, then Noto Sans SC where linked, then today's system fallbacks (`layout.tsx:75-80`) |
| Files | `apps/web/public/fonts/noto-sans-sc/` and `apps/web/public/fonts/noto-sans-arabic/`, with `OFL.txt`, and a README entry with source, version and SHA-256 per file in `apps/web/app/fonts/README.md` |
| PDF | Registered from files on disk with `Font.register`; Chinese line breaking with `Font.registerHyphenationCallback` that splits Han text per character (spike, section 11) |
| Air gap | `fonts-self-hosted` in `scripts/check-air-gap.ts:88` gains a second check: every `url()` in a `@font-face` under `apps/web` is a relative path to a committed file, and the PDF font paths exist. The runbook row at `docs/runbooks/air-gap.md:70` names both |

### 10.3 Bytes

| Case | Catalogue | Font CSS | Font files |
|---|---|---|---|
| English page, no Han or Arabic text | `en` only (4.3) | Arabic rule only, under 2 KB (measure in build) | Geist 69,652 |
| English page with an Arabic name | same | same | Geist + 165,960 |
| `zh-Hans` page | `zh-Hans`: 400,239 raw, 117,944 gzip -9 (UI), see 4.3 | + 101,698 raw / 31,070 gzip, or less after dropping the four non-Han rules | Geist + the Han slices the page's characters touch, each at most 76,324. Measured on Home, OKRs and Check-in at S13 |
| `ar` page | `ar`: 525,880 raw, 125,650 gzip -9 (UI), see 4.3 | Arabic rule | Geist + 165,960 |
| Container image | | | About 13.1 MB added: 4,448,664 + 165,960 web, 8,331,336 + 142,140 PDF. Measured with `docker image inspect` at S13 |

## 11. PDF right to left

### 11.1 Spike, run on 19 November 2026

Run with the repo's `@react-pdf/renderer` 4.9.0 from a scratch script, rendered to PNG with macOS `sips`.

| Check | Result |
|---|---|
| Chinese glyphs with the SC subset OTF | Pass: every character rendered |
| Chinese line wrapping with a per-character hyphenation callback | Pass: wraps inside the margins |
| Arabic letters joined | Pass: initial, medial and final forms join |
| Bidi order with `direction: "rtl"` on the text style | Pass: words run right to left, "(OKR-12)" and "2027" sit where an RTL paragraph puts them |
| Without `direction: "rtl"` | Fail: the paragraph is laid out left to right |
| Glyph completeness | **Fail**: some letters lose their body and keep only their dots (initial "ز" in "زيادة" and "زيت", final "ث" in "الثالث", final "ت" in "زيت"). Same result with the hinted TTF, the unhinted TTF and the OTF |
| Text extraction | Not run: no PDF text tool on the machine |

### 11.2 Before approval

| Step | Pass condition |
|---|---|
| Open the spike PDF in a second viewer (Chrome's PDF viewer) | Decides whether the missing glyphs are in the file or in macOS's rasteriser |
| Run the same script with the newest `@react-pdf/renderer` 4.x | If it passes, the fix is a version bump of an existing dependency |
| Run `pdftotext` (poppler) on the output | The Arabic comes back in logical order |

If all three fail, A-12 asks Akmal: (A, recommended) for `ar`, the minutes "PDF" button opens the minutes print view and the browser's own print to PDF, which shapes Arabic correctly and adds no dependency; or (B) a different PDF library, named with size and licence at that point.

## 12. Formats sweep

Display sites (change to the locale's Intl tag from the registry):

| Site | Today |
|---|---|
| `apps/web/app/activity/page.tsx:59` | `"en-GB"` |
| `apps/web/app/admin/ai/governance.tsx:247-249` | `toLocaleString("en-GB")`; the labels "Calls", "Tokens in", "Tokens out" are also hard-coded English |
| `apps/web/app/admin/ai/page.tsx:505` | `toLocaleString("en-GB")` |
| `apps/web/app/admin/channels/page.tsx:92` | `"en-GB"`, and the fallback `"never"` is hard-coded English |
| `apps/web/app/admin/deleted/page.tsx:76` | `locale === "ms" ? "ms-MY" : "en-GB"` |
| `apps/web/app/admin/invitations/page.tsx:59` | `"en-GB"` |
| `apps/web/app/sessions/page.tsx:43` | `"en-GB"` |
| `apps/web/lib/day-label.ts:19` | `ms` ternary |
| `apps/web/lib/feed-panel.tsx:108` | `"en-GB"` |
| `apps/web/lib/format-price.ts:15` | `"en"` |
| `packages/ui/src/fields/date-format.ts:80` | `locale === "en" ? "en-GB" : locale` (keep, read the tag from the registry) |
| `packages/ui/src/lib/format-measure.ts` | Fixed comma grouping (section 3) |
| `packages/core/src/mail/account.ts:205`, `:211` | `ms` ternary, then `"en-GB"` for time |
| `packages/core/src/mail/mails.ts:40`, `:310` | `ms` ternary |
| `packages/agents/src/evaluation/run.ts:245` | `"en-GB"`; a report for engineers, may stay English (keep, noted) |
| Browser default locale: `account/security/sessions.tsx:121`, `check-in/timeline.tsx:83`, `cycle/gates.tsx:208`, `:216`, `cycle/input-pack.tsx:247`, `cycle/page.tsx:988`, `goals/[id]/page.tsx:785`, `review/nudge-provenance.tsx:138`, `session/[id]/monthly-review.tsx:560`, `welcome/wizard.tsx:95` | `toLocale*String()` with no locale, which uses the browser's or the server's, so server and client can differ. All take the resolved locale |
| Literal language lists: `apps/web/lib/appearance.tsx:51-52`, `admin/general/general-settings-form.tsx:89`, `apps/web/app/goal-nodes.ts:123`, `:198` | Read the registry |

Machine sites (keep; they compute parts or validate a zone, and their output is never shown):

`packages/core/src/channels/members.ts:24`, `packages/core/src/nudges/service.ts:1081`, `packages/core/src/nudges/sweep.ts:652`, `packages/core/src/workspaces/memberships.ts:109`, `packages/core/src/mail/account.ts:200`, `packages/formats/src/timezone.ts:13`, `apps/web/lib/scheduler.ts:509`, `apps/web/lib/stamper.ts:25`, `:29`; and `en-CA` for ISO dates at `packages/formats/src/zoned.ts:13`, `packages/core/src/cycles/generation.ts:83`, `apps/web/app/kpis/[id]/page.tsx:145`, `apps/web/app/kpis/actions.ts:300`, `apps/web/app/kpis/page.tsx:171`. Each gets a one-line comment saying it is machine use, so the sweep's test can allow-list it.

`localeCompare` sites (`admin/audit/page.tsx:78`, `admin/roles/page.tsx:81`, `lib/my-week.ts:77` and others) sort names; they take the locale where they sort names a person reads and stay as they are where they sort ISO dates or ids.

A test greps for `"en-GB"`, `"ms-MY"` and argument-less `toLocale*String()` in `apps/web` and `packages/*/src` and fails outside the allow-list.

## 13. Server-side text

| Question | Decision |
|---|---|
| Where it lives | `packages/core/src/i18n/messages/<code>.json`, one server catalogue. The mail words (`mail/words.ts`, 191 keys), the notification templates, the nudge message's fixed words, the copilot health words (`read-tools.ts:628`), export headers and PDF labels move into it |
| The engine | `translate`, `messageHoles` and plural selection move from `packages/ui/src/i18n/catalogue.ts` to `packages/formats/src/messages.ts`, which both packages may import. Term holes stay in `packages/ui` and reach the engine as a callback |
| Parity | `i18n:check` covers the server catalogue with the same checks as section 6.2, and the same sync and translate commands handle it |
| Nudges and notifications | Keep storing keys and arguments (they store no text today, 1.3). Delivery renders in the recipient's resolved locale; the inbox renders at read time |
| Method words in nudges | The headline and coach line come from `packages/method` in English. Translating them is A-7 |
| Activity summaries | The feed, the inbox and the digest render the sentence at read time in the reader's language from `activity.*` keys in the server catalogue (owner decision 2026-11-22). Stored activity rows keep the kind and the payload only, so old rows follow the reader's language too. User-authored text, such as a comment, stays as written |
| Method texts on screens (D5b, done in 0.10.1) | Phase titles and outputs, gate titles, weekly steps and review stages with their purposes, process-health statements (screen, minutes page, minutes PDF) and the fires and recipient text of every trigger come from the catalogues: `method.phase.<n>.title` and `.output`, `method.gate.<n>.title`, `method.weeklyStep.<n>.*`, `method.reviewStage.<n>.*`, `method.processHealth.<n>`, `method.trigger.<rule key>.fires` and `.recipient`. Keys are listed in `apps/web/lib/method-text-keys.ts`. `pnpm method:check` holds the English equal to `packages/method` in both directions. Also done in 0.10.1, the words D5b left English: root causes (`method.rootCause.<n>`, session screen, minutes page and PDF), management retro questions (`method.managementRetro.<n>`, same three surfaces), close-decision meanings (`method.closeDecision.<decision>`), phase guidance (`method.phase.<n>.guidance.<i>`), trigger names in rule previews (the existing `triggers.*` keys) and trigger fires in the email digest (`method.trigger.<rule key>.fires` in the server catalogue, rendered in the recipient's locale). Still English: the §2.1 horizon note on the cycle guidance rail, and the English labels the `sessions.*` reads return to API callers |
| Drafter | `drafter.ts:367-368` becomes `languageName(locale)` from the registry: an English name for the prompt, such as "German (Deutsch)" |
| Account mail | A-8 |
| Exports | Headers are human-facing, in the requester's locale. Values stay machine values: health keys, ISO dates, numbers with `.` as the decimal point. Reason: the list exports are opened by people in spreadsheets, so headers are read; values must sort and parse the same in every spreadsheet locale. Queued exports resolve the requester's locale at build time from `requested_by_id`; no schema change. Plan L14 also names dates and numbers, so A-11 confirms |
| Minutes PDF | Fully human-facing in the requester's locale, including the page footer (`render.tsx:101-102`), dates and numbers |
| Workspace-wide messages | Invitations and shared channel posts use the workspace language (L-Q10) |
| Channel templates | A WhatsApp template is matched to the resolved locale; with no approved template in that locale, the workspace language's template is used (L-Q10) |

## 14. The method

Nothing in METHOD.md changes until Akmal approves. This section is the proposal.

### 14.1 What depends on language

| Rule | Part | Affected by |
|---|---|---|
| OBJ-1 | Output verbs, movement verbs, why markers, state words, end-state shapes | Words. ASCII-only matching (`quality.ts:533`, `word-lists.ts:238`) |
| OBJ-1 | `hasDigits` | ASCII digits (`quality.ts:593`) |
| OBJ-2 | Word count over 18 | Whitespace splitting (`quality.ts:525-529`); a Chinese title is one word |
| OBJ-2 | Digits other than a year | ASCII digits (`quality.ts:596`) |
| KR-2 | Number count | ASCII digits (`quality.ts:715`, `:825`) |
| KR-5 | Activity nouns, impact words, why markers, output verbs | Words |
| KR-5 | Number count | ASCII digits (`quality.ts:893`) |

### 14.2 How the text's language is known

The skip is keyed on the text, never on the member's locale, so choosing `de` is not a way past a check. Options for A-4:

| Option | Rule | Gap |
|---|---|---|
| A. Script (recommended) | Count letters with Unicode script properties. If more than half are Han or Arabic, the text is "not English" for the word-list parts. Latin text always runs the English lists | German or French text still runs the English lists; it mostly reads "Cannot tell" (`pass`) for OBJ-1 and "Otherwise" for KR-5, as today |
| B. Script plus markers | A plus a short list of function words per Latin language (a new §11 parameter); Latin text with more of another language's markers than English ones is "not English" | Eight new lists to maintain and test |
| C. Workspace lists only | No skip. Workspaces add their own words through `quality.wordLists` (§11) | Needs `contains` to stop stripping accented letters and to match Han text without spaces, a code change; English-only meanwhile |

### 14.3 Questions inside the proposal

| # | Question | Recommendation |
|---|---|---|
| A-5 | OBJ-2's length for Han text | Skip the length condition for Han text (digits still checked) and show the same notice. A character limit would be a new threshold with no source |
| A-6 | Arabic-Indic digits | Normalise U+0660 to U+0669 and U+06F0 to U+06F9 to ASCII before OBJ-1, OBJ-2, KR-2 and KR-5 read digits. Without it, an Arabic key result with "٩٠" reads "Metric with no numbers" and warns |
| A-7 | Rule names, prompts and coach lines in other languages | Translate them: keys generated from `packages/method` (`method.rule.<id>.title`, `.condition.<n>.prompt`, `method.coach.<rule>`), English value checked equal to the package by `pnpm method:check`, rule keys unchanged as citations. UIUX-PLAN §8 already says coaching prompts live in the catalogues, sourced from `packages/method` |

### 14.4 Proposed METHOD.md wording (A-13)

Replace the paragraph at `METHOD.md:414` with:

> **What word lists can and cannot do.** OBJ-1 and KR-5 match words from the §4 lists. KR-2 and the digit conditions of OBJ-1, OBJ-2 and KR-5 count digits; Arabic-Indic digits count as digits. A word list will always be behind English, and the checks are measured against published OKRs (`packages/method/test/published-examples.test.ts`). So no word-list check blocks by default. A person decides what blocks, not a word.
>
> **Text that is not English.** Whether a title or key result is English is read from the text, never from the reader's language setting: text whose letters are mostly Han or Arabic is not English. For such text the word-list conditions of OBJ-1 and KR-5 are not evaluated, OBJ-2 does not count words, and the coach says so: "The word checks read English only, so this text was not checked for them." A check not evaluated is left out of the strength score, as a check that is off is. Every other check, and every digit condition, runs as for English text. A check not evaluated never blocks a publish gate.

## 15. Copilot, agents and evaluation

| Item | Design |
|---|---|
| Copilot | Already receives the member's locale (`answer.ts:278`). The prompt names the language from the registry. An explicit request in the conversation ("reply in English") wins, as L-Q9 says |
| Other capabilities | Every capability that writes text a person reads takes `locale` in its context and names the language in its prompt. Verified list (19 November 2026, from the 25 capabilities in `packages/agents/src/drafter.ts`): `draftCheckIn`, `draftObjective`, `draftMinutes`, `draftRetrospective`, `decomposeKeyResult`, `clusterNotes`, `narrateDigest`, `narrateTrend`, `narrateDiagnostic`, `summariseBlockers`, `summariseThread`, `suggestKpi`, `suggestParent`, `proposeAction`, `planRun`, `parseListFilter`, `proposeImportMapping`, `reviewAlignment`, `refineRecoveryTitle`, `rewriteForRule`, `proposeObjectives`. `answerGrounded` and `streamGrounded` already take it. `chooseReads` and `suggestMeasure` do not: they return keys, numbers and a short unit label. The field is optional, as it is on the grounded question context, and an absent value names English, so cost scripts and tests that build a context by hand keep working |
| Which locale | Text written for a request goes to the requester's locale (`resolveMemberLanguage`). A draft for one named person to read and publish (`draftCheckIn` through a nudge) uses that person's locale. Text that is stored and read by many people (`reviewAlignment`, `refineRecoveryTitle`) uses the workspace language, then the instance default, then English. No new setting |
| No caller yet | `proposeObjectives` has no caller today. It gets `locale` in its interface and its evaluation fixtures, and no wiring |
| Refusal text | The English fallback string in `filter-assist.ts` moves to a catalogue key: it is the line shown when AI is off or the filter cannot be read |
| AI off | The deterministic path renders from the catalogues in the member's locale; nothing in it calls a provider |
| Fixtures | Each text-writing capability gets one fixture per locale. The mock provider returns a canned reply, so the fixture cannot prove what a real model writes. What it can prove: the prompt names the right language (the run already compares prompts, `run.ts:370-371`), and the reply passes a script check (Han for `zh-Hans`, Arabic for `ar`) |
| Live check | `pnpm ai:evaluate --provider <name> --model <id>` once per locale, by hand, before release, with the script check plus a stop-word check per Latin language. It costs provider calls and is never in CI |
| Health words | `read-tools.ts:628` reads the server catalogue |

## 16. Questions for Akmal

Each has a recommendation and a one-word answer.

| # | Question | Recommendation | Answer with |
|---|---|---|---|
| A-1 | Mixed-version rollout (7.4): accept the short degraded window, or split new member codes into the next release? | A: accept, with the mixed-version test | "A" or "B" |
| A-2 | Message format (5.1): plural keys with no dependency, or ICU with `intl-messageformat` precompiled? | A | "A" or "B" |
| A-3 | Which provider and model translate the catalogues? | The provider the team already pays for, through the existing adapter | "anthropic", "openai", "google" or "openrouter" |
| A-4 | How is a text's language known for the method (14.2)? | A: script | "A", "B" or "C" |
| A-5 | OBJ-2 length for Han text | Skip the length condition | "skip" or "limit" |
| A-6 | Count Arabic-Indic digits as digits in the method | Yes | "yes" or "no" |
| A-7 | Translate rule names, prompts and coach lines | Yes, generated from `packages/method` | "yes" or "no" |
| A-8 | Account mail language | The request's locale when there is a request, the instance language otherwise | "request", "instance" or "column" (a new account-level setting, a schema change) |
| A-9 | Cookie notice for `openokr_locale` | List the cookies in the admin docs, no banner | "docs" or "banner" |
| A-10 | Chinese text on non-Chinese pages | System CJK font; the SC stylesheet only on `zh-Hans` pages | "system" or "everywhere" |
| A-11 | Export values | Headers translated, values machine values | "headers" or "all" |
| A-12 | Arabic PDF if the spike in 11.2 still fails | The print view and the browser's print to PDF | "print" or "library" |
| A-13 | The METHOD.md wording in 14.4 | Approve | "approved" or "changes" |

## 17. Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | An instance administrator on a self-hosted instance, or the operator on a cloud | They set the instance language to `de` | New workspaces start in German; a visitor with no cookie and no shipped browser language sees German |
| AC-2 | A `de` instance, a workspace set to `ms`, a member set to `fr` | The member chooses "Follow workspace", then an administrator clears the workspace language | The member sees Malay, then German (not English) |
| AC-3 | A visitor with `Accept-Language: zh-CN,zh;q=0.9,en;q=0.8` and no cookie | They open `/sign-in` | It renders in `zh-Hans` |
| AC-4 | A visitor with `Accept-Language: zh-TW,zh-Hant;q=0.9,en;q=0.8` | They open `/sign-in` | It renders in English, never Simplified Chinese |
| AC-5 | A visitor on the `zh-Hans` sign-in page | They choose English in the switcher | `openokr_locale=en` is set with `Path=/`, `SameSite=Lax`, `HttpOnly`, a one-year lifetime, and English renders on the next visit |
| AC-6 | A built app and a visitor with `Accept-Language: en` | `/sign-in` loads | The browser receives the `en` catalogue and no other, downloads no Noto Sans SC file and no Noto Sans Arabic file, and the transferred catalogue size is recorded |
| AC-7 | An engineer adds one key to `en.json` only | They run `pnpm i18n:sync` and `pnpm check:fast` | The check passes, the nine other files hold the English value, `pending.json` lists the key for nine locales, and `pnpm i18n:check --release` fails naming it |
| AC-8 | A locale file missing a key, a hole, or a plural category | `pnpm i18n:check` runs | It fails naming the file, the key and what is wrong |
| AC-9 | A value in `de.json` equal to English and listed nowhere | `pnpm i18n:check` runs | It fails naming the key |
| AC-10 | `pnpm i18n:translate --locale de` with a reply that drops a hole token | The run finishes | That key stays in `pending.json` and the run reports it; no file holds a broken hole |
| AC-11 | The migration applied | A member row is written with `zh-Hans`, then one with `xx` | The first succeeds, the second fails on `workspace_members_language_known` |
| AC-12 | One migrated database, a 0.9.x build and a 0.10.0 build | A member with `ar` is read, rendered and mailed by the old build; the old build is asked to save `ar`; the new build is asked to save `ar` | The old build renders the workspace language with no error and sends English mail; its save is refused with a validation error and the row is unchanged; the new build's save succeeds |
| AC-13 | A workspace whose stored language is `xx` | An administrator opens General | The picker shows "Not available: xx", members resolve to the instance language, and saving another field keeps `xx` |
| AC-14 | The registry changed | `pnpm check:contract` runs | It is green after `pnpm gen:contract`, and a changeset exists |
| AC-15 | A member with `ar` | They open any screen | `<html lang="ar" dir="rtl">`, the sidebar is on the right, directional icons mirror, and progress bars fill from the right |
| AC-16 | A member with `ar` on the board, focus on a card in the first column | They press `ArrowLeft` | The card moves to the second column, which is on its left on screen |
| AC-17 | A new `ml-2` class in `apps/web` | `pnpm check:fast` runs | The direction check fails naming the file and line |
| AC-18 | An English member typing an Arabic title | They type | The field shows it right to left (`dir="auto"`), and the saved title renders right to left in lists |
| AC-19 | A workspace mail to an `ar` member | It is rendered | The HTML has `lang="ar" dir="rtl"` |
| AC-20 | `s43` and `s43b` with an `ar` member | CI runs them | No serious or critical axe finding; the keyboard flows pass |
| AC-21 | An objective titled "让企业客户在第三季度末之前把满意度提高到百分之九十并且减少流失以及提升续约率" (Han only) | The coach evaluates it | Per A-4 and A-5: OBJ-1's word-list conditions and OBJ-2's word count are not evaluated, the notice shows, the score's denominator excludes them, and no gate blocks on them |
| AC-22 | A key result "رفع رضا العملاء من ٧٠ إلى ٩٠" | KR-2 evaluates it | Per A-6: two numbers are counted and KR-2 passes |
| AC-23 | A member with `de` writing an English objective that starts with "Launch" | The coach evaluates it | OBJ-1 warns "Starts with an output verb", as for an English member |
| AC-24 | The AI provider off and a member with `fr` | They draft an objective | Every coach label and notice is French (per A-7 for rule text), and nothing calls a provider |
| AC-25 | A member with `id` asking the copilot | It answers | The prompt names Indonesian; a live run's reply passes the Indonesian check; "reply in English" switches to English |
| AC-26 | Members A (`pt`) and B (`it`) | One event notifies both | A's mail and inbox entry are Portuguese, B's Italian, from the same stored row |
| AC-27 | A member with `es` exporting goals as CSV, inline and queued | The files are built | Headers are Spanish in both; health values are keys; dates are ISO |
| AC-28 | A member with `ar` asking for the minutes PDF | It is generated offline | Arabic letters are joined and complete, lines run right to left, the footer is Arabic, or per A-12 the print view opens |
| AC-29 | A member with `zh-Hans` | They open Home, OKRs and Check-in | No missing glyphs; the Noto Sans SC slices downloaded are recorded per screen |
| AC-30 | `pnpm check:air-gap` | It runs on the fonts slice | It fails if a `@font-face` URL is remote or missing, and passes with the vendored files |
| AC-31 | A `de` member typing "1.234" into a number field | They leave the field | It is refused as ambiguous with a German message; "1234,5" is read as 1234.5; "١٢٣٤" is read as 1234 |
| AC-32 | An `es` reader | A measure of 1234.56 renders | "1234,56", and 12345.6 renders "12.345,6" |
| AC-33 | A visitor requests a password reset from the `de` sign-in page | The mail is sent | Per A-8, it is German |

## 18. Build slices

Each slice is one commit on its own branch, ends with `pnpm check:fast` and `pnpm test:changed`, and names the spec files it touched. Slices after S8 need the questions they cite answered.

| # | Slice | Deliverables | Tests | Depends on |
|---|---|---|---|---|
| S1 | Locale registry and resolution | `packages/formats/src/locales.ts` (ten codes, `shipped` true for `en` and `ms` only); `resolveMemberLanguage` adds the instance step and returns the registry type; `visitorLocale` reads the registry; `browserLocale` mapping table (8.2); `mailLocale` and `drafter.ts:367` read the registry | `accept-language` table tests including AC-3, AC-4 (with `zh-Hans` marked shipped in the test); AC-2 at the resolver level | Approval |
| S2 | Per-locale catalogue loading | Provider modules per locale; `getCatalogue` server API; `@openokr/ui/catalogues` entry; 45 test imports updated; `translations.ts` and `layout.tsx` updated | AC-6 bundle test; bytes recorded in 4.3 | S1 |
| S3 | Message engine and plurals | Engine moved to `packages/formats/src/messages.ts`; category plurals (or ICU per A-2); count pairs migrated; old-suffix gate | Engine unit tests; Arabic six categories; fallback to `other` | S2, A-2 |
| S4 | Catalogue gate and sync | `same-as-english.ts`; `pending.json`; `pnpm i18n:sync`; `pnpm i18n:check` in `check:fast`; `--release` mode; glossary files for `en` | AC-7, AC-8, AC-9 | S3 |
| S5 | Translate command | `i18n:translate` in `packages/agents` with masking, glossary and validation | AC-10 against the mock provider | S4, A-3 |
| S6 | Server catalogue | `packages/core/src/i18n/messages`; mail words, notification templates, nudge fixed words, health words moved; per-recipient locale at delivery | Parity in `i18n:check`; AC-26 at unit level | S3, S4 |
| S7 | Formats sweep | Every display site in section 12; machine-site comments; `formatMeasure` locale-aware; number input normalisation and ambiguity error; sweep test | AC-31, AC-32 | S1 |
| S8 | Schema and contract | Migration (7.1); Drizzle enum; action enums; settings refinement; "Not available" picker state; `gen:contract`; changeset; `TECHNICAL-PLAN` and `DATABASE.md` lines | AC-11, AC-13, AC-14, AC-12 (option per A-1) | S1, A-1 |
| S9 | Pickers and switcher | Account picker as a select with "Follow workspace"; workspace picker; instance picker on Admin General (self-hosted) and the operator's Instance screen (cloud); signed-out switcher on S-35; cookie; docs entry per A-9 | AC-1, AC-5; e2e for the switcher and Follow workspace | S8 |
| S10 | Right-to-left foundations | `dir` on `<html>`; `DirectionProvider`; `check:direction` with debt list; mail `dir`; `dir="auto"` in fields and TipTap; `pseudo-rtl`; `UIUX-PLAN.md:393` updated | AC-17, AC-18, AC-19 | S1 |
| S11a | RTL sweep, `packages/ui` | Logical classes and styles; icon mirroring | Debt list shrinks; pseudo-rtl screenshots of the kit | S10 |
| S11b | RTL sweep, `apps/web/app` A to K | Same | Debt list shrinks | S11a |
| S11c | RTL sweep, `apps/web/app` L to Z and `apps/web/lib` | Same; debt list empty | Debt list empty | S11b |
| S12 | Arrow keys and charts | The 6 arrow-key files; progress bars and time axes | AC-16; chart unit tests | S10 |
| S13 | Fonts | Vendored files, CSS, stack, README with checksums, air-gap check | AC-6 font part, AC-29 bytes, AC-30; image size recorded | S10, A-10 |
| S14 | Minutes PDF | Locale labels and footer; font registration; RTL or the print view | AC-28 | S6, S13, spike, A-12 |
| S15 | Exports | Header keys in the server catalogue; locale for inline and queued exports | AC-27 | S6, A-11 |
| S16 | AI locale | `locale` on the text-writing capabilities; prompts; fixtures per locale with script checks | AC-25 (mock part) | S1, S6 |
| S17 | Account mail | Per A-8 | AC-33 | S6, A-8 |
| S18 | Method | METHOD.md change (by or with Akmal's approval); `packages/method` script detection, digit normalisation, skip and notice; conformance; method text keys per A-7 | AC-21, AC-22, AC-23, AC-24; `pnpm method:check` | A-4 to A-7, A-13 |
| S19a | Malay additions | `pnpm i18n:translate --locale ms` for keys pending | `i18n:check --release` for `ms` | S5 |
| S19b to S19i | One locale each: `zh-Hans`, `es`, `pt`, `ar`, `de`, `fr`, `it`, `id` | Generated catalogue for app and server; glossary; `shipped: true`; bytes recorded in 4.3 | `i18n:check --release` for that locale; one e2e smoke per locale; for `ar`, AC-15 and AC-20 | S5, S6; `ar` also S11c, S12, S13 |
| S20 | Release checks | Visual review in `ar` at both widths; offline Chinese and Arabic print and PDF; air-gap check; byte table filled; plan §5 rows recorded | Plan §5 | All above |

Order: S1, then S2 to S7 and S10 in any order their dependencies allow, then S8 and S9, then S11 to S18, then S19, then S20. A locale is shipped only when its S19 slice lands, so English and Malay keep working at every step.
