# Adding languages to OpenOKR

Status: **written, waiting for design approved**.

Owner: Akmal. Written 19 November 2026 for the [0.10.0 plan](../plans/release-0.10.0.md). Section 2 records the planning decisions Akmal approved on 19 November. Schema and subsystem changes wait for explicit approval before code.

## 1. What is true today

| Area | Current behaviour | Where |
|---|---|---|
| Instance default | `instance.language` has a stored value, an `OPENOKR_DEFAULT_LANGUAGE` bootstrap value and an English default, in that order. Provisioning uses the resolved value for the new workspace. The current self-host General and cloud Instance screens have no instance-language picker. | `packages/core/src/{secrets/instance-registry,settings/workspace-defaults,workspaces/provisioning}.ts`, `apps/web/app/admin/general/page.tsx`, `apps/web/app/operator/instance/page.tsx`, [settings map](../specification/TECHNICAL-PLAN.md#414-the-settings-map) |
| Workspace default | `workspaces.settings.language` is stored in workspace settings. General offers `en` and `ms`, and preserves a saved value outside those choices. The settings schema accepts a string. | `packages/db/src/schema/workspaces.ts`, `packages/core/src/settings/registry.ts`, `packages/core/src/actions/settings.ts`, `apps/web/app/admin/general/general-settings-form.tsx` |
| Member preference | `workspace_members.language` is nullable. Null follows the workspace. The schema, profile actions and account UI know `en` and `ms`. The column has a database check for those values. | `packages/db/migrations/0078_member_language.sql`, `packages/db/src/schema/workspaces.ts`, `packages/core/src/actions/people.ts`, `apps/web/lib/appearance.tsx`, `apps/web/lib/appearance-action.ts` |
| Request locale | A signed-in workspace request tries member, workspace and English. A visitor or signed-in user without a workspace tries browser, instance and English. Browser matching uses the primary language tag. The root sets `lang`. | `apps/web/lib/{locale,accept-language}.ts`, `apps/web/app/layout.tsx`, `apps/web/test/locale.test.ts` |
| Catalogues | `en.json` and `ms.json` each have 4,986 flat keys. `CATALOGUES` imports both. `translate` fills named values, including terms from workspace overrides. Callers choose count variants. Missing keys throw. | `packages/ui/src/i18n/{catalogue,terms}.ts`, `packages/ui/src/i18n/messages/`, `packages/ui/src/i18n/use-translations.tsx`, `apps/web/lib/translations.ts` |
| Catalogue checks | The UI tests check Malay key and placeholder coverage, forbid unapproved English copies using `SAME_IN_MALAY`, and exercise a pseudo-locale. The web tests check hardcoded text, key consumers, Malay coverage and fragments. | `packages/ui/test/catalogue.test.tsx`, `apps/web/test/catalogue-coverage.test.ts` |
| Fonts and formatting | Geist ships as a local font. Its checked file has no Han or Arabic glyphs. `packages/formats` handles local date shapes and timezone arithmetic. Some screen helpers take a locale, some name English or Malay, and `formatMeasure` uses fixed grouping to keep exact decimal precision. | `apps/web/app/fonts/README.md`, `apps/web/app/layout.tsx`, `packages/formats/src/{date,timezone,zoned}.ts`, `apps/web/lib/{day-label,format-price}.ts`, `packages/ui/src/{fields/date-format,lib/format-measure}.ts` |
| Delivery | Workspace mail uses its workspace's language. Account mail without workspace context uses the instance default. Mail words cover two locales. Chat templates have a language field. The minutes PDF has an English page footer. | `packages/core/src/mail/{words,workspace,account}.ts`, `apps/web/lib/account-mail.ts`, `packages/core/src/channels/template-mappings.ts`, `apps/web/app/session/[id]/minutes/pdf/render.tsx` |
| Method and model replies | Some Draft Coach rules use English word lists. The [acceptance report](../report/uat-0.9.0-report.md) F-04 records an Indonesian answer to a member using Malay. | [METHOD.md](../specification/METHOD.md) §§4, 11 and 12, `packages/method/src/{quality,word-lists}.ts`, `packages/core/src/copilot/{answer,reading}.ts`, `packages/agents/src/drafter.ts` |

## 2. Planning decisions

See [0.10.0 §7](../plans/release-0.10.0.md#7-decisions) for the full questions, alternatives and costs.

| Decision | Direction approved on 19 November 2026 |
|---|---|
| L-Q1 | Reuse the instance, workspace and member settings. Offer the instance default to an instance admin on self-host or an operator on managed cloud. Workspace admins can set or clear their default. Members can follow it or choose their own per workspace. |
| L-Q2 | Extend the existing member column and its check. Prove automatic activation of writes for the new codes after incompatible pods are gone. |
| L-Q3 | Use the code and format choices in sections 3 and 8 and add the signed-out switcher specified in UIUX-PLAN §8. |
| L-Q4 | Apply full right-to-left support for Arabic. |
| L-Q5 | Bundle local Noto Sans SC and Noto Sans Arabic, with measured size and PDF tests. |
| L-Q6 | Use ICU MessageFormat. Bring back any specific new runtime dependency for approval after its licence and size review. |
| L-Q7 | Use machine translation for the initial release. Run the automated checks and ship without native sign-off. Improve the wording gradually after release. |
| L-Q8 | Keep the English word-list checks for English text, with a translated notice when skipped. Settle text-language selection, score, strict mode and gate behaviour in METHOD.md before implementation. |
| L-Q9 | Use the receiving member's resolved locale and allow explicit language requests in direct conversation. Use per-locale fixtures to test reply language, grounding and safe proposals. |
| L-Q10 | Resolve private messages and files for the recipient or requester and choose an approved fallback for unknown recipients and shared channels. |

## 3. Locale list

The web font column lists the face for the script. PDF coverage is verified separately against the renderer. Number, date and count forms follow the chosen locale in section 8.

| Language | Code | Direction | Web font | Convention |
|---|---|---|---|---|
| English | `en` | LTR | Geist | Existing copy and date conventions |
| Malay | `ms` | LTR | Geist | Bahasa Melayu, Malaysia |
| Simplified Chinese | `zh-Hans` | LTR | Noto Sans SC, with Geist for Latin UI | Simplified script |
| Spanish | `es` | LTR | Geist | Neutral Spanish copy, `es` date and number formats |
| Arabic | `ar` | RTL | Noto Sans Arabic, with Geist for Latin UI | Modern Standard Arabic, `ar` date and number formats |
| German | `de` | LTR | Geist | German |
| Portuguese | `pt` | LTR | Geist | Brazilian Portuguese conventions |
| French | `fr` | LTR | Geist | French |
| Italian | `it` | LTR | Geist | Italian |
| Indonesian | `id` | LTR | Geist | Bahasa Indonesia |

## 4. Catalogue layout and loading

| Piece | Proposed design |
|---|---|
| Files | Keep one flat JSON file per locale under `packages/ui/src/i18n/messages/`, named with the locale code. English is the source contract for keys and argument names. Keep namespace keys and whole sentences. Fold count variants into a single message when their call sites move to ICU plurals. |
| Locale registry | Put code, display name and direction in shared lightweight metadata usable by web, UI and core without importing JSON. `packages/formats` already provides a pure shared package for both core and UI. Keep full catalogue loading in `packages/ui`. |
| Loading | Replace the eager import map with an explicit loader per locale. The server resolves the locale once per request, loads its catalogue and passes it to the client provider. Server translation and client revalidation use the same locale and terminology overrides. Check the built chunks for language payloads. |
| Delivery words | Keep the delivery translations usable in server workers without React. Reuse locale resolution and formatting across mail, notifications, chat, human-facing exports and PDFs. Include those keys in parity and argument tests. Start from `packages/core/src/mail/words.ts` and the existing templates. |
| Argument compatibility | Preserve existing `{name}` arguments and the workspace term holes from `packages/ui/src/i18n/terms.ts`. For count-based messages, use ICU plural branches, where the formatter selects a phrase for the count. Compile or parse only local assets. Keep both server and client on the same formatter and verify pseudo-locale behaviour. |
| Missing messages | Fail the build for incomplete shipping catalogues. Keep the error for a missing key. English is the last locale in preference resolution. |

## 5. Settings and fallback

| Context | Proposed order or behaviour |
|---|---|
| Signed in with a workspace | **Member → workspace → instance → English.** Skip absent, unsupported or unreadable choices. Preserve absence in the workspace resolver so a synthetic English settings default cannot hide the instance fallback. Read the instance only if the member and workspace do not resolve. |
| Signed out or without a workspace | **Explicit device choice → browser → instance → English.** Keep the existing browser order beneath the proposed switcher. Match canonical supported tags first. Accept explicit Simplified Chinese tags and common Simplified regions such as `zh-CN` and `zh-SG`. A bare `zh` may select `zh-Hans`. Skip Traditional tags or regions and continue the preference list. |
| Saved values | Keep saved workspace choices, including values copied at creation, and saved `en` and `ms` member choices. Null member language follows the workspace. Preserve unsupported legacy strings and skip them during resolution. Offer locales that pass the release checks and are enabled for the deployment. |
| Role and storage | Use existing permissions at each setting's scope. Reuse `instance.language`, workspace settings and `workspace_members.language`. Record and verify the setting paths in TECHNICAL-PLAN §4.14. Extend the member profile input and output contracts and regenerate their projections. |
| Rolling upgrade | Use a forward migration to widen the member check. Establish a rollout condition before enabling new writes, because an older `people.readMember` output schema can reject a new code even after the database accepts it. Test web and worker overlap on one database. Preserve the existing stored values. See [PLAN.md](../specification/PLAN.md) §5.1. |
| Private outputs | Use the member recipient's locale in the relevant workspace. Use the workspace default for an invite without a preference. Without a workspace context, account mail uses the instance default. Use the requester for an inline or queued export and PDF. Shared chat uses the workspace default and an approved channel template. |

## 6. Right-to-left layout

| Area | Proposed design |
|---|---|
| Direction | Set `lang` and `dir` on `<html>` in `apps/web/app/layout.tsx` from the resolved locale. Ensure dialogs, popovers, menus, tooltips and other portalled content inherit the direction. Use the same language and direction in rendered mail and PDF output where the format supports it. |
| Layout | Audit both `apps/web` and `packages/ui`. Replace direction-dependent left/right spacing, alignment, borders and positioning with logical start/end properties. Check navigation, drawers, tables, forms, boards, editors and tooltips at desktop and mobile widths. Keep keyboard and reading order aligned. |
| Icons and charts | Mirror icons that express direction, such as next and back. Mirror chart layout and label placement when it follows reading order. Check time, value axes, scale and series semantics with the chart's data and preserve their meaning. Check dragging and keyboard movement on the board. |
| Mixed text | Let content direction follow the text where appropriate, using `dir="auto"` or bidirectional isolation for names and embedded values. Give code, URLs and identifiers an LTR context. Check Arabic text beside dates, numbers, Latin names and citation chips. |
| Visual pass | Use the route inventory in `e2e/s43-accessibility.spec.ts` as the starting list. Capture and review every user-facing screen in Arabic at desktop and mobile widths. Include auth, admin and operator screens, shared overlays, errors, empty states and the main interactive flows. Check focus, labels and clipping. |

## 7. Fonts and the air gap

| Choice | Design and checks |
|---|---|
| Local assets, recommended | Commit Noto Sans SC and Noto Sans Arabic with version, checksum, licence and provenance beside the fonts. Serve local faces by script and load them when used. Use only offline build inputs. Measure the added image size, first page transfer and PDF size. |
| System web fonts | Fallback on devices with suitable installed faces. The PDF renderer uses the chosen local faces for shaping and embedding. |
| PDF | Verify the font formats supported by the existing renderer before selecting assets. Check Arabic shaping, line ordering and text extraction, and Simplified Chinese wrapping and coverage. Test user-authored text alongside translated labels. |
| Offline verification | Run the [air-gap checks](../runbooks/air-gap.md) and verify a cold build and a cold page request with external access disabled. Check Chinese and Arabic examples for missing glyphs. |

## 8. Dates, numbers and plurals

| Kind | Proposed design |
|---|---|
| Dates and times | Use the resolved locale with `Intl.DateTimeFormat` and pass the timezone explicitly. Use the workspace timezone for workspace presentation and preserve the existing timezone rules for other contexts. Keep date-only values as calendar dates so changing the locale or timezone cannot shift the day. Reuse `packages/formats/src/{date,timezone,zoned}.ts`. |
| Numbers | Use `Intl.NumberFormat` for display, with an explicit locale and unit or currency where applicable. Preserve the precision of stored decimal strings from `packages/ui/src/lib/format-measure.ts`. Under L-Q3, accept local decimals and digits in human-facing number inputs, reject ambiguous values and store canonical numeric values. Keep human display separate from machine-readable formats. |
| Plurals | Use `Intl.PluralRules` through ICU MessageFormat for each locale. Require `other` and verify each supported category with fixture counts. Arabic needs `zero`, `one`, `two`, `few`, `many` and `other`. Malay, Simplified Chinese and Indonesian can use `other` for cardinal plurals in the checked Node runtime. Derive the remaining categories from the runtime and test them. Do not assume an English singular and plural pair works everywhere. |
| Consistency | Pass the same locale and timezone to client, server and worker rendering. Test decimals, grouping, zero, negatives, count agreement and ambiguous dates. Verify date-only round trips and that browser hydration agrees with server output. |

## 9. Translation workflow and maintenance

| Step | Work |
|---|---|
| Prepare | Generate translations in batches by screen or template. Provide complete messages, screen context, placeholder notes and an OKR glossary tied to METHOD.md. Include strings for G4 and outward delivery. |
| Generate | Use machine translation for the initial release. Keep values, markup and workspace term placeholders intact. Record intended English matches by locale and key, with a reason. |
| Validate | Run catalogue, placeholder, plural, format and delivery checks for every shipping language. Verify the RTL layout and offline fonts. Native translation sign-off is optional after release. |
| Method and replies | Translate method labels and messages subject to the approved policy. Ask Akmal before changing the checks, thresholds or profiles. Exercise per-locale fixtures in `packages/agents/src/evaluation/sets.ts` and deterministic outputs with the provider off. |
| Maintain | Record reported wording issues by locale and key. Fix them in batches and keep the glossary current. Start the Malay follow-up with the [13 review items](../report/malay-review-0.9.0.md) still open after 0.9.1. |

## 10. Tests

| Gate | What it checks |
|---|---|
| Catalogue completeness | Parameterise `packages/ui/test/catalogue.test.tsx` and `apps/web/test/catalogue-coverage.test.ts` over the release registry. Require the same keys as English, including detection of extra keys. Retain consumer, hardcoded-text, fragment and pseudo-locale checks. Apply parity to delivery catalogues too. |
| English matches | Generalise `SAME_IN_MALAY` into locale-specific exceptions with a reason per key. Fail on an unapproved match and on a stale exception. Address wording quality as issues are reported. |
| Placeholders and ICU | Parse each message, compare required argument names and compatible types with English, including term holes, and verify valid plural branches for that locale. Render representative counts and nested values. Fail on malformed syntax, missing `other` or an unresolved placeholder. Check pseudo-localisation preserves the syntax. |
| Settings and upgrade | Extend `apps/web/test/locale.test.ts` and test settings writes and reads through their existing paths. Check clearing, permissions, signed-out negotiation and data from before the change. Exercise a mixed-version rollout with new codes gated until safe. |
| RTL and formats | Run the screenshot pass in section 6 and locale-format tests in the browser and server. Check PDFs and cold offline font loading. |
| Delivery and evaluation | Check workspace and instance fallbacks and two different recipients of one event. Verify chat template choice, inline and queued export parity, offline rendering, and per-locale copilot and agent fixtures, including provider off. |

## 11. Acceptance criteria

| Given | When | Then |
|---|---|---|
| An instance admin changes the deployment default | A workspace is provisioned and a member with no override signs in | The workspace starts with that language, and the member can select any enabled locale. |
| A member chose `fr`, their workspace chose `ms` and the instance chose `en` | The member clears their preference, then a workspace admin clears the workspace default | They first see Malay and then English. A second workspace keeps its own preference. |
| A request presents an unsupported member or workspace value and the instance uses an enabled locale | The locale is resolved | It skips the unsupported values and uses the instance locale. It uses English when no earlier choice resolves. |
| A signed-out visitor has no explicit choice and the browser requests `zh-TW`, then `zh-CN` | The visitor opens sign-in | The first range is skipped and sign-in renders in Simplified Chinese. A later explicit device choice wins. |
| A pod on the old release is still serving | A new pod renders the account settings | New locale writes stay unavailable and existing English and Malay settings work on both. The new choices become writable after safe activation. |
| A member uses Arabic on an isolated instance | They open the board, an editor and a PDF with Arabic and Latin text | Arabic reads right to left, directional controls follow the reading order, and glyphs render from local assets. Chart scales and mixed text remain legible. |
| An enabled translation has a missing key, broken plural branch or renamed argument | The catalogue tests run | The gate reports the locale and message key and fails. |
| A machine-translated catalogue and its delivery templates pass all applicable release checks | The release enables that locale | Members can select it. Wording issues can be fixed in later catalogue updates. |
| Two recipients prefer different languages | The same event reaches each by private message | The system text uses each recipient's locale. Shared posts use the workspace default. File labels follow the requester, and stable data fields keep their canonical format. |
| A member uses a non-English language and the provider is off | They use the Draft Coach and receive a deterministic nudge | The approved method policy runs and any skipped word-list checks are explained. System words use the resolved locale and the rule keys still resolve. |
