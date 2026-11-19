# Plan: release 0.10.0

Owner: Akmal. Started 19 November 2026.

Status: **planning decisions approved on 19 November 2026**. Akmal assigned G4 and the additional languages to 0.10.0 and accepted the directions in section 7. This answers Q1 in the [KPI access design](../design/kpi-access.md). Both designs still need explicit "design approved" before code.

This minor release adds access and imported shares for individual KPIs. It adds Simplified Chinese, Spanish, Arabic, German, Portuguese, French, Italian and Indonesian alongside English and Malay. The [language design](../design/languages.md) sets out the proposed implementation. The [0.9.1 patch](release-0.9.1.md) carries the known issues and the existing Malay copilot fix.

Each numbered row is one change in the CLAUDE.md change loop. **S** is under a day, **M** is a few days and **L** is about a week or more. Translation and validation need their own lead time. Dependencies refer to rows or decisions in this plan.

## 1. Per-KPI access and FlowyTeam shares

| # | What a person meets | Change | Design first | Size | Depends on |
|---|---|---|---|---|---|
| G4 | Human access to a KPI comes from the workspace role. A Viewer with an old FlowyTeam update share cannot record a reading on that KPI, and a guest's individual share does not carry over. The importer lists `indicator_accesses` among unread tables. See `packages/core/src/access/reads.ts`, `packages/core/src/actions/kpis.ts` and `packages/importer/src/flowyteam/unread.ts`. | Build KPI contexts, the access resolver, audited sharing actions and a share list first. Then read FlowyTeam shares through the read-only importer and map `read` to `view` and `update` to `edit`. Report what cannot carry over and flag broader visibility for human review before import. | Yes, [KPI access](../design/kpi-access.md) | L | G4-Q1, G4-Q2. KPI access before import. |

## 2. Language infrastructure

The settings already exist. The [settings map](../specification/TECHNICAL-PLAN.md#414-the-settings-map) names the instance default, workspace default and member preference. `packages/core/src/settings/workspace-defaults.ts` resolves the instance setting and `packages/core/src/workspaces/provisioning.ts` uses it when provisioning. `apps/web/app/admin/general/general-settings-form.tsx` offers English and Malay for a workspace. `apps/web/lib/appearance.tsx` offers them per member. `apps/web/lib/locale.ts` selects member, workspace, then English for signed-in workspace requests, and browser, instance, then English for visitors. Reuse these settings and controls. Extend the choices, expose the existing instance setting in admin and add the missing signed-in instance fallback.

| # | What a person meets | Change | Design first | Size | Depends on |
|---|---|---|---|---|---|
| L1 | The workspace and account pickers offer two languages. The instance default exists in storage and the environment, but the inspected instance screens offer no picker for it. | Share locale codes, labels and direction across pickers and validators. Extend the existing admin and account paths, add Follow workspace, and add the instance picker with its existing permission boundary. Add a signed-out switcher per UIUX-PLAN §8. Design the forward schema change and a safe rolling rollout before accepting new member codes. | Yes | M | L-Q1, L-Q2, L-Q3 |
| L2 | English and Malay are imported together by `packages/ui/src/i18n/catalogue.ts`. Messages take named placeholders, while callers pick count variants. Both catalogues have 4,986 keys in this checkout. | Load only the selected catalogue. Keep English as the source. Add locale-aware formatting and ICU MessageFormat plural support after approval, with a compatibility path for named holes and a pass over count variants and fragmented strings. Extend both catalogue tests to iterate supported locales. Require a reason per locale and key for intentional English matches, as `SAME_IN_MALAY` does today. | Yes | L | L1, L-Q3, L-Q6 |
| L3 | The app sets `lang` and has left/right layout rules. Arabic needs right-to-left layout, including shared components. | Set `dir="rtl"` for Arabic at the root. Replace physical left/right with logical start/end throughout `apps/web` and `packages/ui` where direction follows reading order. Mirror directional icons and chart layouts where meaning follows reading order. Review every screen at mobile and desktop widths. | Yes | L | L1, L-Q4 |
| L4 | The bundled Geist face has no Han or Arabic glyphs. A device with thin system fonts or a PDF renderer without a suitable face may omit characters. | Prove offline browser coverage and PDF embedding, shaping and text extraction with Noto Sans SC and Noto Sans Arabic. Record licences, updates and measured image, page and PDF byte costs. See `apps/web/app/fonts/` and the [air-gap runbook](../runbooks/air-gap.md). | Yes | M | L-Q5 |

## 3. The catalogues

The English web catalogue contains 4,986 keys. Eight new catalogues at that size mean about 40,000 key entries before mail, notifications, chat, exports and plural changes. Generate initial translations from complete messages, screen context and the OKR glossary. Run the automated catalogue and format checks before release. The initial release does not require native review. Track wording issues for gradual correction.

| # | Locale | Change | Design first | Size | Depends on |
|---|---|---|---|---|---|
| L5 | English `en` and Malay `ms` | Keep both as baselines. Run parity, format and browser regressions. Track any of the [13 doubtful Malay items](../report/malay-review-0.9.0.md) still open after 0.9.1. Use machine translation for Malay additions. | Language design | M | L2, L-Q7, 0.9.1 C4 for the Malay copilot baseline |
| L6 | Simplified Chinese `zh-Hans` | Review Han glyph coverage, line wrapping and the locale's count messages. Check browser language ranges for Simplified and Traditional Chinese. | Language design | L | L2, L4, L-Q3, L-Q7 |
| L7 | Spanish `es` and Portuguese `pt` | Generate and validate each catalogue independently. Check decimal separators, dates and plural forms with the chosen regional conventions. | Language design | L | L2, L-Q3, L-Q7 |
| L8 | Arabic `ar` | Generate the Arabic catalogue and test its plural forms and mixed Arabic and Latin content. Complete the RTL walkthrough. | Language design | L | L2, L3, L4, L-Q3, L-Q7 |
| L9 | German `de`, French `fr` and Italian `it` | Generate each catalogue. Check long labels, accents, wrapping and count messages. | Language design | L | L2, L-Q3, L-Q7 |
| L10 | Indonesian `id` | Generate an Indonesian catalogue. Test catalogue coverage and reply language independently of Malay. | Language design | L | L2, L-Q3, L-Q7 |

## 4. The method, the agents and what leaves the browser

| # | What a person meets | Change | Design first | Size | Depends on |
|---|---|---|---|---|---|
| L11 | English word lists in the Draft Coach often miss equivalent wording in other languages. Structural checks still have their inputs. See [METHOD.md](../specification/METHOD.md) §§4, 11 and 12 and `packages/method/src/{quality,word-lists}.ts`. | Implement the policy Akmal approves. Localise the notice and existing rule labels. Cover strict mode, score denominators and publish gates explicitly in the method decision and its conformance tests. | Yes, method approval | M under the recommended option | L2, L-Q8 |
| L12 | A translated interface can still show a copilot or agent answer in another language. The 0.9.0 report saw Indonesian in a Malay session. | Pass the receiving member's locale to copilot, drafts and agent writing paths. Add evaluation sets per locale for language, terminology, grounding, proposals and AI-off behaviour. See `packages/core/src/copilot/{answer,reading}.ts`, `packages/agents/src/{drafter,evaluation/sets}.ts` and [AI evaluation](../design/ai-evaluation.md). | Yes | L | L1, L2, L-Q9, 0.9.1 C4 |
| L13 | Mail words cover English and Malay. Workspace mail uses the workspace language, and account mail uses the instance default. Chat templates have their own language field. | Resolve locale for each recipient of email, notifications and chat. Render labels and system messages in that locale and preserve user-authored content. Match approved channel templates to the resolved locale, with an agreed fallback. See `packages/core/src/mail/{words,workspace,account}.ts`, `packages/core/src/notifications/{templates,drain}.ts` and `packages/core/src/channels/template-mappings.ts`. | Yes | L | L1, L2, L-Q7, L-Q10 |
| L14 | Browser choices do not automatically reach queued exports or the minutes PDF. The PDF renderer has an English page footer. | Use the recipient or export requester's resolved locale for human-facing headers, dates, numbers, and PDF labels and layout. Give the same locale to inline and queued exports. Keep machine-readable field names and values stable. See `packages/core/src/exports/{lists,worker}.ts`, `apps/web/app/session/[id]/minutes/pdf/route.ts` and `apps/web/app/session/[id]/minutes/pdf/render.tsx`. | Yes | L | L1, L2, L4, L-Q10 |

## 5. Checks before the release

| Area | Check |
|---|---|
| KPI access | Run the [KPI design](../design/kpi-access.md) acceptance cases and compare dry-run and import reports. Cover Viewer, guest and Member outcomes, grant removal and tenant boundaries. |
| Settings and upgrade | Test signed-in and signed-out fallback, workspace switching, clearing an override, saved unknown codes, existing English and Malay settings, and a mixed-version rollout. Document the constraint change and any data change. |
| Catalogue and formats | Run key, consumer, placeholder, plural, pseudo-locale and English-match checks for all shipping locales. Verify dates, numbers, decimal precision and mixed-script output. |
| Visual and offline | Review every screen in Arabic at desktop and mobile widths, and check a representative Simplified Chinese and Arabic print and PDF sample offline. Run the air-gap check and measure the font bytes. |
| Translation and delivery | Run automated checks for every shipping locale and capture wording issues for follow-up. Test two members with different preferences across copilot, agents, mail, notifications, chat, exports and PDFs. Verify the provider-off path. |

## 6. Left out on purpose

| Item | Where it belongs |
|---|---|
| 0.9.0 known issues | [0.9.1](release-0.9.1.md), per Akmal's decision. |
| Translation of user-authored records or historical messages | Future work if requested. This plan changes the words OpenOKR supplies. |
| More regional catalogues and translated manuals | A separate scope decision. L-Q3 picks the first conventions for the ten interface locales. |

## 7. Decisions

Akmal accepted the recommended directions on 19 November 2026 and chose machine translation for the first release, with gradual wording fixes after it ships.

| # | Question | Recommended | Cost | Akmal's answer |
|---|---|---|---|---|
| G4-Q1 | Is the KPI access design approved for 0.10.0, including grants by the KPI owner, Owner or Admin? | Approve the grant authority. Build per-KPI access before importing the shares. | About a week in the design estimate. KPI reads and the access data change need full verification. | Direction approved. Explicit design approval before code still applies. |
| G4-Q2 | May the import carry additive grants and report FlowyTeam restrictions, view options and frequencies that cannot carry over? | Yes. Keep the `read` and `update` mapping and report the limits plainly in dry runs and imports. Flag any source visibility restrictions whose loss would expose a KPI more broadly under the target's roles, for human review before import. | Adds reconciliation and may require an operator to resolve affected KPIs before import. Full parity would need a different access model. | Approved as recommended |
| L-Q1 | Which admins choose each default, and what happens to defaults already saved? | Instance admin on self-host and cloud operator on managed cloud set the deployment default. Workspace admins set their workspace default. Members keep their own per-workspace choice or follow the workspace. Preserve saved workspace values and use the instance default when there is no usable workspace value. | Adds an instance picker and a clear-to-inherit action. Existing saved workspace choices still take precedence. | Approved as recommended |
| L-Q2 | How should the new choices become writable during a mixed-version rollout? | Enable writes of new member codes automatically after old pods are out of service, with a mixed-version acceptance test. If automatic activation cannot be proved, bring back a separate compatibility step for approval. | Adds rollout coordination and testing. A separate compatibility step would add release work. | Approved as recommended |
| L-Q3 | Which locale conventions, number input and signed-out selection should 0.10.0 ship? | Approve the ten codes in the design and the listed conventions. Accept locale-specific decimal input in human-facing fields, with a clear error for ambiguous values. Add the UIUX-PLAN §8 signed-out switcher and use its device preference first, then the browser, instance and English. | Needs locale number tests, a visitor preference and tests for language-range matching, especially Chinese script. | Approved as recommended |
| L-Q4 | Did "LTR support" mean right-to-left (RTL) support for Arabic? | Yes. Approve full RTL, including logical CSS, mirrored directional icons and chart layouts, and a visual pass on every screen. | Large cross-app change, with mobile and desktop review of every screen. | Approved as recommended |
| L-Q5 | Should we bundle Noto Sans SC and Noto Sans Arabic locally, or use system fonts? | Bundle local fonts for consistent offline coverage and PDF embedding. Measure the image and transfer cost, especially for Chinese, and version and license both assets. | Larger assets and maintenance. System fonts save web bytes but vary by device and offer no reliable PDF coverage by themselves. | Approved as recommended |
| L-Q6 | May the catalogue add a local ICU MessageFormat implementation if a runtime dependency is needed? | Approve the smallest compatible implementation after a licence, bundle and offline check. Keep all messages local and use `Intl` for locale rules. Return for approval with the actual dependency and cost before adding it. | Adds a parser or build step and migration of count messages. A new runtime dependency requires explicit approval. | Approach approved. Any specific new dependency still needs approval. |
| L-Q7 | Who drafts each translation, and may a locale ship before native review? | Use machine translation for the initial release. Run the automated release checks and improve wording gradually. | About 40,000 new web entries at the current size, plus delivery templates. Wording and terminology corrections continue after release. | Approved with machine translation only for the initial release. Native review is optional after release. |
| L-Q8 | How should METHOD.md handle language-dependent checks? | Run the English word-list parts on English text only and show a notice where they are skipped. Keep deterministic structural checks in all locales. Agree how text language is known and how skipped checks affect scores, strict mode and gates before changing METHOD.md. | English-only leaves a coaching gap and needs a method change. Per-language lists multiply maintenance and conformance work. Optional AI-assisted advice adds evaluation and provider cost. | English-only direction approved. The detailed method change still needs approval. |
| L-Q9 | Which language should the copilot and agents use, and how should they be evaluated? | Default to the receiving member's resolved locale. Honour explicit language requests in direct conversation. Use that locale for proposals, drafts and nudges, and test fixtures per locale for language, grounding and safe proposals. Keep deterministic rules and AI-off delivery working in each locale. | Adds prompt, locale-routing and fixture work. Live evaluations cost provider calls. | Approved as recommended. Initial translation needs no native fixture sign-off. |
| L-Q10 | Which locale should outward messages and files use when the recipient is unknown or the audience is shared? | Use the recipient for private email, notifications and chat. Use the workspace default for invitations and shared channel posts. Use the instance default when there is no workspace. Use the requester for human-facing exports and PDFs. Keep machine-readable formats stable and use an approved fallback template if a channel has no approved locale variant. | Adds per-recipient rendering and template approval work. Shared channels get one audience-wide language. | Approved as recommended |

## 8. Suggested order

1. Apply section 7 to the designs and seek explicit approval. Start G4's access work and **L1** independently once approved. Finish the KPI access checks before importing shares.
2. Build **L2**, with **L3** and **L4** in parallel once their decisions are settled. Use English and Malay (**L5**) to prove the path, then ship a language that exercises the script and layout changes in a test build.
3. Generate translations for **L6** to **L10** and include G4's final UI strings and the delivery templates. Build **L11** to **L14** once their locale interfaces are ready and the detailed method change is approved.
4. Run the release checks in section 5 and verify a mixed-version upgrade before enabling the new choices on a running deployment.

## 9. Build log

Statuses: **to do**, **design written**, **done**, **merged**, **yours** (decision or action for Akmal).

| Row | Status | Note |
|---|---|---|
| G4 | design written | Akmal approved the release direction on 19 November 2026. Fold G4-Q2 into the KPI access design and obtain explicit approval before code. |
| L1 to L14 | design written | [Language design](../design/languages.md) records the decisions of 19 November 2026. Implementation is pending. |
| Section 7 | decided | Akmal approved the directions and chose machine translation for the initial release. |
