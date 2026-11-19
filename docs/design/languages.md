# Adding languages to OpenOKR

Status: **ready for design approved, 19 November 2026**.

Owner: Akmal. Written 19 November 2026 for the [release 0.10.0 plan](../plans/release-0.10.0.md).
Section 2 records the planning decisions Akmal approved on 19 November 2026 (L-Q1 to L-Q10). This document establishes the detailed design across language infrastructure, catalogues, RTL presentation, offline fonts, ICU MessageFormat, METHOD.md conformance, copilot/agent localization, delivery templates, and mixed-version rollout. It awaits explicit "design approved" before code (CLAUDE.md).

## 1. Context and current state

| Area | Current behaviour | Where checked |
|---|---|---|
| Instance default | `instance.language` has a stored value in instance settings, an `OPENOKR_DEFAULT_LANGUAGE` bootstrap value, and an English fallback. Workspace provisioning uses the resolved instance value. The current self-host General screen and cloud Instance screen have no instance-language picker. | `packages/core/src/secrets/instance-registry.ts`, `packages/core/src/settings/workspace-defaults.ts`, `packages/core/src/workspaces/provisioning.ts`, `apps/web/app/admin/general/page.tsx`, `apps/web/app/operator/instance/page.tsx`, [settings map](../specification/TECHNICAL-PLAN.md#414-the-settings-map) |
| Workspace default | `workspaces.settings.language` stores the workspace default. The general settings form offers `en` and `ms`, preserving any unknown saved string. | `packages/db/src/schema/workspaces.ts`, `packages/core/src/settings/workspace-defaults.ts`, `apps/web/app/admin/general/general-settings-form.tsx` |
| Member preference | `workspace_members.language` is nullable (null follows workspace). The column check constraint restricts values to `('en', 'ms')`. Profile actions and account UI know only `en` and `ms`. | `packages/db/migrations/0078_member_language.sql`, `packages/db/src/schema/workspaces.ts`, `packages/core/src/actions/people.ts`, `apps/web/lib/appearance.tsx` |
| Request locale | Signed-in workspace requests try member, workspace, then English. Visitors or requests without workspace context try browser `Accept-Language`, instance default, then English. The root layout sets `lang`. | `apps/web/lib/locale.ts`, `apps/web/lib/accept-language.ts`, `apps/web/app/layout.tsx` |
| Catalogues | `en.json` and `ms.json` contain 4,986 flat keys each. `CATALOGUES` imports both eagerly. `translate` fills named arguments and workspace term holes. Callers choose count variants manually. Missing keys throw. | `packages/ui/src/i18n/catalogue.ts`, `packages/ui/src/i18n/terms.ts`, `packages/ui/src/i18n/use-translations.tsx`, `apps/web/lib/translations.ts` |
| Quality gates | UI tests check Malay key parity, argument compatibility, forbid unapproved English copies using `SAME_IN_MALAY`, and test pseudo-locales. Web tests check hardcoded text and coverage. | `packages/ui/test/catalogue.test.tsx`, `apps/web/test/catalogue-coverage.test.ts` |
| Fonts and formatting | Geist ships locally but lacks Han and Arabic glyphs. `packages/formats` formats dates and times. `formatMeasure` uses fixed grouping. | `apps/web/app/fonts/README.md`, `apps/web/app/layout.tsx`, `packages/formats/src/date.ts`, `packages/formats/src/timezone.ts`, `packages/formats/src/zoned.ts`, `packages/ui/src/lib/format-measure.ts` |
| Delivery | Workspace mail uses workspace language; account mail uses instance default. Mail words cover English and Malay. External chat templates have a language field. Minutes PDF has an English footer. | `packages/core/src/mail/words.ts`, `packages/core/src/mail/workspace.ts`, `packages/core/src/mail/account.ts`, `packages/core/src/channels/template-mappings.ts`, `apps/web/app/session/[id]/minutes/pdf/render.tsx` |
| Method & AI replies | Quality rules OBJ-1, KR-5, and KR-2 use English word lists. Copilot answers have occasionally replied in Indonesian to a Malay query. | [METHOD.md](../specification/METHOD.md) §§4, 11 and 12, `packages/method/src/quality.ts`, `packages/method/src/word-lists.ts`, `packages/core/src/copilot/answer.ts`, `packages/core/src/copilot/reading.ts`, `packages/agents/src/drafter.ts`, `packages/agents/src/evaluation/sets.ts` |

## 2. Planning decisions (19 November 2026)

The following decisions were approved by Akmal in [release 0.10.0 plan](../plans/release-0.10.0.md) §7:

| Decision | Summary |
|---|---|
| **L-Q1** | **Authority over defaults.** Instance admin on self-host and cloud operator on managed cloud set the deployment default. Workspace admins set workspace default or clear it to inherit. Members choose per workspace or select "Follow workspace". Saved values are preserved. |
| **L-Q2** | **Mixed-version rollout.** Forward migration `0172_member_language_codes.sql` widens the check constraint on `workspace_members.language` to all 10 locales. Writes of new member language codes are gated until old pods (whose action schemas only accept `en` and `ms`) are out of service, verified with mixed-version acceptance tests. |
| **L-Q3** | **Locale conventions & signed-out switcher.** Ship 10 locales (section 3). In human-facing number inputs, accept locale-specific decimal separators with an error on ambiguous input. Add a signed-out switcher (UIUX-PLAN §8) prioritizing: explicit device cookie preference (`openokr_locale`) > browser `Accept-Language` > instance default > English. |
| **L-Q4** | **Full RTL for Arabic.** Full right-to-left layout for Arabic (`dir="rtl"` on `<html>`, logical CSS start/end, mirrored directional icons/charts, `dir="auto"` / `<bdi>` for bidirectional text). Visual review of all screens on mobile and desktop. |
| **L-Q5** | **Local font bundling.** Bundle Noto Sans SC and Noto Sans Arabic locally for air-gap compliance and reliable PDF shaping. Measured image footprint is ~20–25 MB uncompressed (~10 MB WOFF2). SIL Open Font License 1.1. |
| **L-Q6** | **ICU MessageFormat.** Smallest compatible implementation. Candidate: `@formatjs/intl` / `intl-messageformat` (BSD-3-Clause, ~14 kB min+gzip, pure JS, offline). Marked as **requiring owner's approval**; no dependency added yet. |
| **L-Q7** | **Machine translation for 0.10.0.** Machine translation for the initial release across the 8 new locales and Malay additions. Automated catalogue gates enforce zero missing keys and valid plurals. Native translation review is optional post-release. |
| **L-Q8** | **METHOD.md word-list checks.** Run English word-list checks only on English text; skip them with a translated notice for non-English text. Structural checks run in all locales. Skipped checks are excluded from the score denominator and do not block strict mode/gates. (Exact METHOD.md text proposed below for Akmal's approval). |
| **L-Q9** | **Copilot & agents language.** Default to the receiving member's resolved locale. Honour explicit language requests in conversation. Localize drafts, proposals, and nudges. Include evaluation fixtures per locale; maintain deterministic AI-off path. |
| **L-Q10** | **Outward messages & files.** Private email/notifications use recipient's resolved workspace locale. Shared channel posts and invitations use workspace default. Account-level mail uses instance default. Human-facing exports and PDFs use requester's locale. Machine-readable identifiers/keys remain stable English strings. |

## 3. Supported locales

| Language | Code | Direction | Web & PDF Font | Number / Date Convention |
|---|---|---|---|---|
| English | `en` | LTR | Geist (Latin) | US / UK conventions (`1,234.56`, `MM/DD/YYYY` or `DD/MM/YYYY`) |
| Malay | `ms` | LTR | Geist (Latin) | Bahasa Melayu (`1,234.56`, `DD/MM/YYYY`) |
| Simplified Chinese | `zh-Hans` | LTR | Noto Sans SC (bundled) + Geist | Simplified Han (`1,234.56`, `YYYY/MM/DD`) |
| Spanish | `es` | LTR | Geist (Latin) | Neutral Spanish (`1.234,56`, `DD/MM/YYYY`) |
| Arabic | `ar` | RTL | Noto Sans Arabic (bundled) + Geist | Modern Standard Arabic (`١٬٢٣٤٫٥٦` or `1,234.56`, `DD/MM/YYYY`) |
| German | `de` | LTR | Geist (Latin) | Standard German (`1.234,56`, `DD.MM.YYYY`) |
| Portuguese | `pt` | LTR | Geist (Latin) | Brazilian Portuguese (`1.234,56`, `DD/MM/YYYY`) |
| French | `fr` | LTR | Geist (Latin) | Standard French (`1 234,56`, `DD/MM/YYYY`) |
| Italian | `it` | LTR | Geist (Latin) | Standard Italian (`1.234,56`, `DD/MM/YYYY`) |
| Indonesian | `id` | LTR | Geist (Latin) | Bahasa Indonesia (`1.234,56`, `DD/MM/YYYY`) |

## 4. Architecture and catalogue loading

1. **Lightweight Locale Registry (`packages/formats/src/locales.ts`)**:
   - Contains metadata (code, label, native label, script direction, font family) without importing messages.
   - Usable across core, web, db, and formats without bundle bloat.

2. **Decoupled Dynamic Catalogue Loading (`packages/ui/src/i18n/loader.ts`)**:
   - Replace eager static import of all JSON files in `packages/ui/src/i18n/catalogue.ts` with explicit per-locale chunk loaders.
   - The web server resolves the locale once per request, dynamically loads the single matching catalogue (`packages/ui/src/i18n/messages/<locale>.json`), and hydrates the client `TranslationProvider`.
   - Browser client bundles download only the active locale's messages.

3. **Plural handling & ICU compatibility**:
   - For simple strings, keep `{name}` named placeholders and workspace terminology tags (`{term:objective}`).
   - For count-based messages, replace ad-hoc `key_one` / `key_other` branching with standard ICU MessageFormat plural syntax:
     `{count, plural, one {# item} other {# items}}`.
   - Arabic includes full 6-category plural forms: `zero`, `one`, `two`, `few`, `many`, `other`.

## 5. Schema change and mixed-version rollout

### Database schema migration
- **Migration file**: `packages/db/migrations/0172_member_language_codes.sql`.
- **DDL change**:
  ```sql
  alter table workspace_members
    drop constraint if exists workspace_members_language_check;

  alter table workspace_members
    add constraint workspace_members_language_check
    check (language in ('en', 'ms', 'zh-Hans', 'es', 'ar', 'de', 'pt', 'fr', 'it', 'id'));
  ```
- **RLS and Tenant Floor**:
  Table `workspace_members` already has `workspace_id`, `force row level security`, and policy `tenant_isolation` (created in `0001_core.sql`). No new table is added.

### Mixed-version rollout strategy (L-Q2)
1. **The incompatibility risk**:
   Older pods running 0.9.1 have schemas in `packages/core/src/actions/people.ts` (`readMember`, `updateMemberProfile`) validating `language: z.enum(["en", "ms"]).nullable()`. If a user on a 0.10.0 pod saves a new language code (e.g. `ar`), an older pod reading that member row will throw a schema validation error.
2. **Rollout execution**:
   - Phase 1: Apply migration `0172_member_language_codes.sql` to the database. The database now allows all 10 codes.
   - Phase 2: Deploy 0.10.0 application pods. During rolling update, UI language pickers restrict member selection to `en` and `ms` (or new choices remain disabled).
   - Phase 3: Once all old 0.9.1 pods are completely decommissioned and drained, automated activation enables the new 8 language choices in member settings.
   - Verified by mixed-version integration test: old pod reads member with null/en/ms; old pod does not encounter new codes until drained.

## 6. Right-to-Left (RTL) layout implementation (L-Q4)

1. **Document root**:
   - In `apps/web/app/layout.tsx`:
     ```tsx
     <html lang={locale} dir={localeDirection(locale)}>
     ```
   - When `locale === "ar"`, `dir="rtl"`.
2. **CSS Logical Properties refactor**:
   - Systematically replace physical directional CSS utilities in `apps/web` and `packages/ui`:
     - `ml-*` / `mr-*` -> `ms-*` / `me-*` (`margin-inline-start`, `margin-inline-end`).
     - `pl-*` / `pr-*` -> `ps-*` / `pe-*` (`padding-inline-start`, `padding-inline-end`).
     - `border-l` / `border-r` -> `border-s` / `border-e` (`border-inline-start`, `border-inline-end`).
     - `left-*` / `right-*` -> `start-*` / `end-*` (`inset-inline-start`, `inset-inline-end`).
     - `text-left` / `text-right` -> `text-start` / `text-end`.
3. **Directional icon mirroring**:
   - Direction-conveying icons (back/forward arrows, breadcrumb chevrons, collapse/expand carats) receive `rtl:rotate-180` or conditional SVG mirroring.
   - Non-directional icons (search, settings, checkmarks, trash, user avatars) do not mirror.
4. **Interactive components**:
   - Task boards: Columns render from right to left; keyboard navigation (`ArrowRight` moves leftward in visual space) aligns with RTL reading order.
   - Charts: Progress bars, timeline charts, and category axes orient from right to left where time/sequence represents reading flow. Value axes preserve standard mathematical orientation.
5. **Bidirectional text isolation**:
   - Wrap dynamic user text (goal titles, KPI names, user notes) with `<bdi>` or `dir="auto"`.
   - Ensure URLs, code blocks, UUIDs, and email addresses retain explicit `dir="ltr"`.

## 7. Bundled local fonts and air-gap verification (L-Q5)

1. **Font assets**:
   - **Noto Sans SC** (Simplified Chinese): WOFF2 subset (~8–10 MB; uncompressed OTF ~15–20 MB) placed in `apps/web/app/fonts/noto-sans-sc/`.
   - **Noto Sans Arabic**: WOFF2 for web and TTF for PDF engine (~1.5 MB) placed in `apps/web/app/fonts/noto-sans-arabic/`.
   - **Licence**: SIL Open Font License 1.1 (`OFL.txt` stored alongside fonts).
   - **Docker footprint**: Increases container image size by ~20–25 MB uncompressed.
2. **Air-gap compliance**:
   - In accordance with `docs/runbooks/air-gap.md`, zero external font CDNs (Google Fonts, Adobe Fonts) are used.
   - Cold builds and cold page requests function completely offline without network access.
3. **PDF rendering & shaping**:
   - In `apps/web/app/session/[id]/minutes/pdf/render.tsx`, register local TTF fonts with the PDF engine.
   - Validate Arabic glyph shaping (proper joining of initial, medial, final, isolated forms) and Bidi reordering.
   - Validate Simplified Chinese text wrapping and font embedding to prevent character drop.

## 8. ICU MessageFormat runtime dependency proposal (L-Q6)

> [!IMPORTANT]
> **Pending Owner Approval**: In accordance with CLAUDE.md and L-Q6, no new runtime dependency is added to `package.json` until explicit approval from the owner.

### Proposed Candidate: `@formatjs/intl` / `intl-messageformat`
- **Package**: `intl-messageformat`
- **Licence**: **BSD-3-Clause** (permissive, commercial-friendly).
- **Bundle size**: **~14 kB minified + gzipped** (~45 kB unpacked).
- **Dependencies**: None. Pure JavaScript. Directly uses native ECMAScript `Intl.PluralRules` available in Node 22 and modern evergreen browsers.
- **Suitability**: Handles full cardinal and ordinal plural categories across all 10 locales, including Arabic's 6 plural forms. Runs identically in browser clients, Node.js SSR, background mail workers, and PDF generation.

## 9. Draft Coach & METHOD.md conformance (L-Q8)

In `packages/method/src/word-lists.ts` and `packages/method/src/quality.ts`, quality rules OBJ-1 ("Outcome, not output"), KR-5 ("Movement or milestone"), and parts of KR-2 match words from English-specific word lists (output verbs, movement verbs, state words).

### Language-dependent behavior
- For **English text**: Word-list checks execute normally against the quality canon.
- For **Non-English text** (determined by drafting member's session locale or explicit language tag):
  - Word-list matching is skipped.
  - A translated informational notice is displayed in the coaching panel: *"Word-list quality checks are skipped for non-English draft."*
  - **Structural checks** (character length bounds, numeric metric targets, baseline/target distinction, timeframe presence) continue to execute for all locales.
  - **Strength score**: Skipped word-list checks are excluded from the evaluated checks denominator so the score is neither penalized nor artificially inflated.
  - **Strict mode & publish gates**: Skipped word-list checks do not block draft progression or publication.

### Proposed METHOD.md amendment (Requires Akmal's explicit approval)

> ### Proposed wording for `docs/specification/METHOD.md` §4:
>
> "The word-list checks in OBJ-1, KR-5 and parts of KR-2 evaluate English vocabulary only. When drafting in another language (determined by the drafting member's resolved locale or explicit language tag), word-list evaluations are skipped, and a translated advisory notice is presented: *'Word-list quality checks are skipped for non-English text.'*
>
> Skipped word-list checks are excluded from the strength score evaluation denominator (neither penalizing nor artificially inflating the score). Structural checks—including character bounds, numeric targets, baseline-target differences, and timeframe constraints—continue to execute across all languages. Under strict mode or publishing gates, skipped word-list checks do not block progression."

*(Note: In accordance with standing instructions, `docs/specification/METHOD.md` is not modified directly in this task; this wording awaits Akmal's formal approval.)*

## 10. Copilot, agents, and outward messages (L-Q9 & L-Q10)

### Copilot and agents (L-Q9)
- **Context passing**: `packages/core/src/copilot/answer.ts`, `packages/core/src/copilot/reading.ts`, and `packages/agents/src/drafter.ts` receive the member's resolved session locale in their context payload.
- **Model prompt instruction**: Prompts instruct the LLM to reply in the user's requested language while grounding on repository facts. If a user explicitly converses in another language (e.g. asking in English while using an Arabic UI), the assistant replies in the conversed language.
- **AI evaluation**: Extend `packages/agents/src/evaluation/sets.ts` and `docs/design/ai-evaluation.md` with golden evaluation fixtures in each supported locale, testing reply language, terminology adherence, grounding, and proposal safety.
- **AI-off path**: When AI is disabled, all deterministic agent nudges and fallback system responses use static localized strings from the UI catalogue.

### Outward communications (L-Q10)
- **Private email and in-app notifications**: Rendered in the individual recipient's resolved workspace locale (`packages/core/src/mail/workspace.ts`, `packages/core/src/notifications/templates.ts`).
- **Workspace invitations and public broadcast posts**: Rendered in the workspace default language.
- **Account-level security alerts** (password resets, passkey registrations): Rendered in the instance default language (`packages/core/src/mail/account.ts`).
- **Exports and PDFs**: Rendered in the requester's resolved locale (`packages/core/src/exports/lists.ts`, `apps/web/app/session/[id]/minutes/pdf/render.tsx`).
- **Machine-readable formats**: CSV export columns, JSON API payloads, and internal audit tags remain stable canonical English identifiers.
- **Channel template fallback**: If an external channel (e.g. WhatsApp, Slack) lacks an approved template for a given locale, it falls back to the workspace default template.

## 11. Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | An instance admin on self-host or operator on cloud | They set the instance default language to `de` (German) | Newly provisioned workspaces default to German; visitors without preferences see German. |
| AC-2 | A workspace member with preference `fr`, in a workspace defaulting to `ms`, on an instance defaulting to `en` | The member clears their preference to "Follow workspace", then an admin clears workspace default | The member first sees Malay (`ms`), and after workspace default is cleared, sees English (`en`). |
| AC-3 | A signed-out visitor with browser `Accept-Language: zh-CN, zh;q=0.9, en;q=0.8` and no device cookie | The visitor navigates to `/sign-in` | The page renders in Simplified Chinese (`zh-Hans`). When the visitor chooses English from the signed-out switcher, an `openokr_locale` cookie is set and English renders on subsequent visits. |
| AC-4 | A deployment undergoing rolling upgrade from 0.9.1 to 0.10.0 | An active 0.9.1 pod handles a member profile query | The 0.9.1 pod succeeds; new language code writes remain gated until all 0.9.1 pods are decommissioned. |
| AC-5 | A member with language set to Arabic (`ar`) | They open the application | Root `<html>` sets `dir="rtl"` and `lang="ar"`, layouts use logical start/end positioning, directional icons mirror, chart sequences flow right-to-left, and local Noto Sans Arabic fonts render offline without missing glyphs. |
| AC-6 | A member drafting an OKR in French (`fr`) with AI provider turned off | They enter a French objective and view the Draft Coach panel | English word-list checks (OBJ-1, KR-5) are skipped with the translated notice; structural checks execute; the strength score excludes skipped checks from the denominator; and the member is not blocked from publishing. |
| AC-7 | A member using Indonesian (`id`) asking a question in the Copilot chat | The Copilot generates an answer | The response is written in Indonesian adhering to OKR terminology, grounded in workspace records. If the member explicitly says "Reply in English", the response switches to English. |
| AC-8 | Two members in the same workspace: Member A prefers `pt` (Portuguese) and Member B prefers `it` (Italian) | An action triggers a private notification to both members | Member A receives email/notification in Portuguese; Member B receives email/notification in Italian. |
| AC-9 | A workspace member requesting a Minutes PDF export in Arabic | The PDF worker generates the PDF document | The PDF is shaped correctly with local Noto Sans Arabic, includes RTL text layout, and displays dates and numbers in Arabic conventions. |
| AC-10 | Automated CI catalogue tests running against all 10 locales | A message key is missing or has a broken ICU plural syntax in any locale | The catalogue test fails with the exact file, key, and syntax error. |
