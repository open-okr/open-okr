import { LOCALES } from "@openokr/formats";

const ENDONYMS = Object.fromEntries(
  LOCALES.map(({ endonymKey }) => [endonymKey, "Language endonym"]),
);

const VENDOR_NAMES = {
  "admin.ai.providerAnthropic": "Vendor name",
  "admin.ai.providerGoogle": "Vendor name",
  "admin.ai.providerOpenai": "Vendor name",
  "admin.ai.providerOllama": "Product name",
  "admin.ai.providerOpenrouter": "Product name",
  "admin.channels.groupWhatsapp": "Product name",
  "channels.slack": "Product name",
  "channels.teams": "Product name",
  "channels.telegram": "Product name",
  "channels.whatsapp": "Product name",
  "people.detail.profileForm.slack": "Product name",
  "people.detail.profileForm.telegram": "Product name",
  "people.detail.profileForm.whatsapp": "Product name",
};

/**
 * Ledger of keys whose values are legitimately identical to English
 * in each language (docs/design/languages.md §6.4).
 *
 * Every entry must have a non-empty reason explaining why the word or phrase
 * is the same as in English.
 */
export const SAME_AS_ENGLISH: Record<string, Record<string, string>> = {
  "zh-Hans": { ...ENDONYMS, ...VENDOR_NAMES },
  es: {
    ...ENDONYMS,
    ...VENDOR_NAMES,
    "search.exportButton.excel": "Product name",
  },
  pt: {
    ...ENDONYMS,
    ...VENDOR_NAMES,
    "search.exportButton.excel": "Product name",
  },
  ar: {
    ...ENDONYMS,
    ...VENDOR_NAMES,
    "search.exportButton.excel": "Product name",
  },
  de: {
    ...ENDONYMS,
    ...VENDOR_NAMES,
    "search.exportButton.excel": "Product name",
  },
  fr: {
    ...ENDONYMS,
    ...VENDOR_NAMES,
    "search.exportButton.excel": "Product name",
  },
  ms: {
    "appearance.german": "Language endonym",
    "appearance.french": "Language endonym",
    "appearance.arabic": "Language endonym",
    "appearance.portuguese": "Language endonym",
    "appearance.simplifiedChinese": "Language endonym",
    "appearance.spanish": "Language endonym",
    "admin.branding.images.faviconTitle":
      'Product, vendor and language names. "Logo" and "Favicon" are the words Malay uses, and the file summary is two placeholders and a unit (docs/design/workspace-logo-favicon.md).',
    "admin.branding.images.fileSummary":
      'Product, vendor and language names. "Logo" and "Favicon" are the words Malay uses, and the file summary is two placeholders and a unit (docs/design/workspace-logo-favicon.md).',
    "admin.branding.images.logoTitle":
      'Product, vendor and language names. "Logo" and "Favicon" are the words Malay uses, and the file summary is two placeholders and a unit (docs/design/workspace-logo-favicon.md).',
    "admin.branding.mirror.part.favicon":
      'Product, vendor and language names. "Logo" and "Favicon" are the words Malay uses, and the file summary is two placeholders and a unit (docs/design/workspace-logo-favicon.md).',
    "admin.branding.mirror.part.logo":
      'Product, vendor and language names. "Logo" and "Favicon" are the words Malay uses, and the file summary is two placeholders and a unit (docs/design/workspace-logo-favicon.md).',
    "admin.channels.groupWhatsapp":
      'Product, vendor and language names. "Logo" and "Favicon" are the words Malay uses, and the file summary is two placeholders and a unit (docs/design/workspace-logo-favicon.md).',
    "shell.version.running":
      "A version number and nothing else (docs/design/version-footer.md).",
    "copilot.copilotPanel.step.working":
      "A step the copilot is on, followed by an ellipsis: the step is the translated part (plan 0.8.1 CP9).",
    "shell.demo.label":
      '"Demo" is the word Malay uses, as for logo and favicon above; the pill\'s full sentence is translated (plan 0.8.0 D1).',
    "method.detail.okrChampion":
      '"Demo" is the word Malay uses, as for logo and favicon above; the pill\'s full sentence is translated (plan 0.8.0 D1).',
    "method.detail.okrCoach":
      '"Demo" is the word Malay uses, as for logo and favicon above; the pill\'s full sentence is translated (plan 0.8.0 D1).',
    "admin.ai.providerAnthropic":
      '"Demo" is the word Malay uses, as for logo and favicon above; the pill\'s full sentence is translated (plan 0.8.0 D1).',
    "admin.ai.providerGoogle":
      '"Demo" is the word Malay uses, as for logo and favicon above; the pill\'s full sentence is translated (plan 0.8.0 D1).',
    "admin.ai.providerOllama":
      '"Demo" is the word Malay uses, as for logo and favicon above; the pill\'s full sentence is translated (plan 0.8.0 D1).',
    "admin.ai.providerOpenai":
      '"Demo" is the word Malay uses, as for logo and favicon above; the pill\'s full sentence is translated (plan 0.8.0 D1).',
    "admin.ai.providerOpenrouter":
      '"Demo" is the word Malay uses, as for logo and favicon above; the pill\'s full sentence is translated (plan 0.8.0 D1).',
    "admin.ai.agentCalls.copilotRead":
      "Only holes and punctuation: when, who and the outcome (plan 0.9.0 L3).",
    "admin.sso.oidc":
      "Only holes and punctuation: when, who and the outcome (plan 0.9.0 L3).",
    "admin.sso.saml2":
      "Only holes and punctuation: when, who and the outcome (plan 0.9.0 L3).",
    "admin.sso.ssoForm.oidcOpenIdConnect":
      "Only holes and punctuation: when, who and the outcome (plan 0.9.0 L3).",
    "channels.slack":
      "Only holes and punctuation: when, who and the outcome (plan 0.9.0 L3).",
    "channels.teams":
      "Only holes and punctuation: when, who and the outcome (plan 0.9.0 L3).",
    "channels.telegram":
      "Only holes and punctuation: when, who and the outcome (plan 0.9.0 L3).",
    "channels.whatsapp":
      "Only holes and punctuation: when, who and the outcome (plan 0.9.0 L3).",
    "people.detail.profileForm.slack":
      "Only holes and punctuation: when, who and the outcome (plan 0.9.0 L3).",
    "people.detail.profileForm.teams":
      "Only holes and punctuation: when, who and the outcome (plan 0.9.0 L3).",
    "people.detail.profileForm.telegram":
      "Only holes and punctuation: when, who and the outcome (plan 0.9.0 L3).",
    "people.detail.profileForm.whatsapp":
      "Only holes and punctuation: when, who and the outcome (plan 0.9.0 L3).",
    "search.exportButton.csv":
      "Only holes and punctuation: when, who and the outcome (plan 0.9.0 L3).",
    "search.exportButton.excel":
      "Only holes and punctuation: when, who and the outcome (plan 0.9.0 L3).",
    "appearance.english":
      "Only holes and punctuation: when, who and the outcome (plan 0.9.0 L3).",
    "appearance.bahasaMelayu":
      "Only holes and punctuation: when, who and the outcome (plan 0.9.0 L3).",
    "copilot.copilotPanel.copilot":
      "Only holes and punctuation: when, who and the outcome (plan 0.9.0 L3).",
    "account.apiTokens.audienceRest":
      "The name of an API style, which the glossary keeps as it is.",
    "activity.pnpmAuditVerify":
      "Code, commands, formats and example values a person types as shown.",
    "admin.ai.privacy.allowedHostsPlaceholder":
      "Code, commands, formats and example values a person types as shown.",
    "admin.imports.exportCard.kb":
      "Code, commands, formats and example values a person types as shown.",
    "admin.imports.exportCard.sha":
      "Code, commands, formats and example values a person types as shown.",
    "admin.invitations.exampleComExampleOrg":
      "Code, commands, formats and example values a person types as shown.",
    "admin.sso.ssoForm.certificatePlaceholder":
      "Code, commands, formats and example values a person types as shown.",
    "admin.sso.ssoForm.discoveryUrlPlaceholder":
      "Code, commands, formats and example values a person types as shown.",
    "admin.sso.ssoForm.emailDomainsPlaceholder":
      "Code, commands, formats and example values a person types as shown.",
    "admin.sso.ssoForm.issuerPlaceholder":
      "Code, commands, formats and example values a person types as shown.",
    "admin.sso.ssoForm.providerIdPlaceholder":
      "Code, commands, formats and example values a person types as shown.",
    "admin.sso.ssoForm.scopesPlaceholder":
      "Code, commands, formats and example values a person types as shown.",
    "admin.sso.ssoForm.signOnUrlPlaceholder":
      "Code, commands, formats and example values a person types as shown.",
    "admin.sso.ssoForm.urlPlaceholder":
      "Code, commands, formats and example values a person types as shown.",
    "common.esc":
      "Code, commands, formats and example values a person types as shown.",
    "common.enter":
      "Code, commands, formats and example values a person types as shown.",
    "common.ai": "Abbreviations the method keeps in English in every language.",
    "dev.components.ai":
      "Abbreviations the method keeps in English in every language.",
    "term.kpi.singular":
      "Abbreviations the method keeps in English in every language.",
    "workMap.kr":
      "Abbreviations the method keeps in English in every language.",
    "okrDiagram.addKeyResult":
      "Abbreviations the method keeps in English in every language.",
    "workMap.obj":
      "Abbreviations the method keeps in English in every language.",
    "kpis.suggestion.unit": "Words Bahasa Melayu uses as they are.",
    "admin.agents.levelEdit": "Words Bahasa Melayu uses as they are.",
    "admin.agents.proposalQueue.items.one":
      "Words Bahasa Melayu uses as they are.",
    "admin.ai.model": "Words Bahasa Melayu uses as they are.",
    "admin.imports.import": "Words Bahasa Melayu uses as they are.",
    "admin.imports.wizard.importRows": "Words Bahasa Melayu uses as they are.",
    "checkIn.composer.status": "Words Bahasa Melayu uses as they are.",
    "common.edit": "Words Bahasa Melayu uses as they are.",
    "cycle.drafting.unit": "Words Bahasa Melayu uses as they are.",
    "dev.components.neutral": "Words Bahasa Melayu uses as they are.",
    "kpis.detail.formula": "Words Bahasa Melayu uses as they are.",
    "lib.sectionTabs.grid": "Words Bahasa Melayu uses as they are.",
    "people.detail.bio": "Words Bahasa Melayu uses as they are.",
    "session.detail.quarterlyReview.actRetro":
      "Words Bahasa Melayu uses as they are.",
    "sessions.schedule.kind": "Words Bahasa Melayu uses as they are.",
    "review.checkInSays": "Only holes and punctuation.",
    "admin.imports.archiveImportCard.leftOutColumns":
      "A table and the columns an older archive carried, both named as stored.",
    "common.caution":
      "The label for the caution status is the \"At risk\" term's own hole, so a workspace's rename reaches it (METHOD.md section 3.5, P9-T15b-a).",
    "copilot.copilotPanel.preview.cycle":
      "The label for the caution status is the \"At risk\" term's own hole, so a workspace's rename reaches it (METHOD.md section 3.5, P9-T15b-a).",
    "copilot.copilotPanel.preview.keyResult":
      "The label for the caution status is the \"At risk\" term's own hole, so a workspace's rename reaches it (METHOD.md section 3.5, P9-T15b-a).",
    "copilot.copilotPanel.preview.objective":
      "The label for the caution status is the \"At risk\" term's own hole, so a workspace's rename reaches it (METHOD.md section 3.5, P9-T15b-a).",
    "copilot.copilotPanel.preview.space":
      "The label for the caution status is the \"At risk\" term's own hole, so a workspace's rename reaches it (METHOD.md section 3.5, P9-T15b-a).",
    "goals.detail.decompose.refused":
      "The label for the caution status is the \"At risk\" term's own hole, so a workspace's rename reaches it (METHOD.md section 3.5, P9-T15b-a).",
    "board.board.movedTo":
      "The label for the caution status is the \"At risk\" term's own hole, so a workspace's rename reaches it (METHOD.md section 3.5, P9-T15b-a).",
    "checkIn.timeline.bylineDate":
      "The label for the caution status is the \"At risk\" term's own hole, so a workspace's rename reaches it (METHOD.md section 3.5, P9-T15b-a).",
    "checkIn.walkerLine":
      "The label for the caution status is the \"At risk\" term's own hole, so a workspace's rename reaches it (METHOD.md section 3.5, P9-T15b-a).",
    "cycle.actions.measureRefusedBecause":
      "The label for the caution status is the \"At risk\" term's own hole, so a workspace's rename reaches it (METHOD.md section 3.5, P9-T15b-a).",
    "documents.subjectDocuments.authorAndVersions":
      "The label for the caution status is the \"At risk\" term's own hole, so a workspace's rename reaches it (METHOD.md section 3.5, P9-T15b-a).",
    "initiatives.metaKeyResults":
      "The label for the caution status is the \"At risk\" term's own hole, so a workspace's rename reaches it (METHOD.md section 3.5, P9-T15b-a).",
    "initiatives.metaWindowKeyResults":
      "The label for the caution status is the \"At risk\" term's own hole, so a workspace's rename reaches it (METHOD.md section 3.5, P9-T15b-a).",
    "workMapHeader.scopeSummary":
      "The label for the caution status is the \"At risk\" term's own hole, so a workspace's rename reaches it (METHOD.md section 3.5, P9-T15b-a).",
    "cycle.drafting.space":
      "Only a term, which each language fills with its own word or the workspace's rename (M-14), sometimes beside a hole or a bracket.",
    "board.scope.inSpace":
      "Only a term, which each language fills with its own word or the workspace's rename (M-14), sometimes beside a hole or a bracket.",
    "board.scope.ofObjective":
      "Only a term, which each language fills with its own word or the workspace's rename (M-14), sometimes beside a hole or a bracket.",
    "common.champion":
      "Only a term, which each language fills with its own word or the workspace's rename (M-14), sometimes beside a hole or a bracket.",
    "common.confidence":
      "Only a term, which each language fills with its own word or the workspace's rename (M-14), sometimes beside a hole or a bracket.",
    "common.count":
      "Only a term, which each language fills with its own word or the workspace's rename (M-14), sometimes beside a hole or a bracket.",
    "areaTabs.goals.kpis":
      "Only a term, which each language fills with its own word or the workspace's rename (M-14), sometimes beside a hole or a bracket.",
    "common.count.keyResult.one":
      "Only a term, which each language fills with its own word or the workspace's rename (M-14), sometimes beside a hole or a bracket.",
    "common.count.keyResult.other":
      "Only a term, which each language fills with its own word or the workspace's rename (M-14), sometimes beside a hole or a bracket.",
    "common.count.objective.one":
      "Only a term, which each language fills with its own word or the workspace's rename (M-14), sometimes beside a hole or a bracket.",
    "common.count.objective.other":
      "Only a term, which each language fills with its own word or the workspace's rename (M-14), sometimes beside a hole or a bracket.",
    "common.keyResult":
      "Only a term, which each language fills with its own word or the workspace's rename (M-14), sometimes beside a hole or a bracket.",
    "common.kpis":
      "Only a term, which each language fills with its own word or the workspace's rename (M-14), sometimes beside a hole or a bracket.",
    "kpis.countOne":
      "Only a term, which each language fills with its own word or the workspace's rename (M-14), sometimes beside a hole or a bracket.",
    "pageTitle.adminImports":
      'Tab titles that are only the workspace term, or "Import", which Malay borrows.',
    "nav.item.admin-imports":
      'The same three words as navigation labels (UAT 0.8.0 F-08): "Import", which Malay borrows, and the abbreviations AI and OKR.',
    "nav.item.admin-ai":
      'The same three words as navigation labels (UAT 0.8.0 F-08): "Import", which Malay borrows, and the abbreviations AI and OKR.',
    "nav.group.okr":
      'The same three words as navigation labels (UAT 0.8.0 F-08): "Import", which Malay borrows, and the abbreviations AI and OKR.',
    "pageTitle.checkIn":
      'The same three words as navigation labels (UAT 0.8.0 F-08): "Import", which Malay borrows, and the abbreviations AI and OKR.',
    "pageTitle.cycle":
      'The same three words as navigation labels (UAT 0.8.0 F-08): "Import", which Malay borrows, and the abbreviations AI and OKR.',
    "pageTitle.kpi":
      'The same three words as navigation labels (UAT 0.8.0 F-08): "Import", which Malay borrows, and the abbreviations AI and OKR.',
    "pageTitle.kpis":
      'The same three words as navigation labels (UAT 0.8.0 F-08): "Import", which Malay borrows, and the abbreviations AI and OKR.',
    "pageTitle.objective":
      'The same three words as navigation labels (UAT 0.8.0 F-08): "Import", which Malay borrows, and the abbreviations AI and OKR.',
    "pageTitle.space":
      'The same three words as navigation labels (UAT 0.8.0 F-08): "Import", which Malay borrows, and the abbreviations AI and OKR.',
    "pageTitle.spaces":
      'The same three words as navigation labels (UAT 0.8.0 F-08): "Import", which Malay borrows, and the abbreviations AI and OKR.',
    "common.reviewer":
      'The same three words as navigation labels (UAT 0.8.0 F-08): "Import", which Malay borrows, and the abbreviations AI and OKR.',
    "cycle.admin.title":
      'The same three words as navigation labels (UAT 0.8.0 F-08): "Import", which Malay borrows, and the abbreviations AI and OKR.',
    "cycle.reviewAndLearn.keyResults":
      'The same three words as navigation labels (UAT 0.8.0 F-08): "Import", which Malay borrows, and the abbreviations AI and OKR.',
    "cycle.setup.facilitator":
      'The same three words as navigation labels (UAT 0.8.0 F-08): "Import", which Malay borrows, and the abbreviations AI and OKR.',
    "cycle.setup.sponsor":
      'The same three words as navigation labels (UAT 0.8.0 F-08): "Import", which Malay borrows, and the abbreviations AI and OKR.',
    "goals.detail.keyResults":
      'The same three words as navigation labels (UAT 0.8.0 F-08): "Import", which Malay borrows, and the abbreviations AI and OKR.',
    "inbox.subject.checkIn":
      'The same three words as navigation labels (UAT 0.8.0 F-08): "Import", which Malay borrows, and the abbreviations AI and OKR.',
    "inbox.subject.cycle":
      'The same three words as navigation labels (UAT 0.8.0 F-08): "Import", which Malay borrows, and the abbreviations AI and OKR.',
    "inbox.subject.kpi":
      'The same three words as navigation labels (UAT 0.8.0 F-08): "Import", which Malay borrows, and the abbreviations AI and OKR.',
    "inbox.subject.space":
      'The same three words as navigation labels (UAT 0.8.0 F-08): "Import", which Malay borrows, and the abbreviations AI and OKR.',
    "initiatives.space":
      'The same three words as navigation labels (UAT 0.8.0 F-08): "Import", which Malay borrows, and the abbreviations AI and OKR.',
    "kpis.grid.kpi":
      'The same three words as navigation labels (UAT 0.8.0 F-08): "Import", which Malay borrows, and the abbreviations AI and OKR.',
    "scorecard.cycle":
      'The same three words as navigation labels (UAT 0.8.0 F-08): "Import", which Malay borrows, and the abbreviations AI and OKR.',
    "search.checkIn":
      'The same three words as navigation labels (UAT 0.8.0 F-08): "Import", which Malay borrows, and the abbreviations AI and OKR.',
    "search.checkIns":
      'The same three words as navigation labels (UAT 0.8.0 F-08): "Import", which Malay borrows, and the abbreviations AI and OKR.',
    "search.cycle":
      'The same three words as navigation labels (UAT 0.8.0 F-08): "Import", which Malay borrows, and the abbreviations AI and OKR.',
    "search.objective":
      'The same three words as navigation labels (UAT 0.8.0 F-08): "Import", which Malay borrows, and the abbreviations AI and OKR.',
    "search.objectives":
      'The same three words as navigation labels (UAT 0.8.0 F-08): "Import", which Malay borrows, and the abbreviations AI and OKR.',
    "search.space":
      'The same three words as navigation labels (UAT 0.8.0 F-08): "Import", which Malay borrows, and the abbreviations AI and OKR.',
    "session.detail.minutes.objectives":
      'The same three words as navigation labels (UAT 0.8.0 F-08): "Import", which Malay borrows, and the abbreviations AI and OKR.',
    "sessions.schedule.facilitator":
      'The same three words as navigation labels (UAT 0.8.0 F-08): "Import", which Malay borrows, and the abbreviations AI and OKR.',
    "sessions.schedule.space":
      'The same three words as navigation labels (UAT 0.8.0 F-08): "Import", which Malay borrows, and the abbreviations AI and OKR.',
    "spaces.spaces":
      'The same three words as navigation labels (UAT 0.8.0 F-08): "Import", which Malay borrows, and the abbreviations AI and OKR.',
    "okrList.keyResultsBand":
      "A line made only of holes: the workspace's own word for its key results and how many there are. Nothing to translate.",
    "newMenu.kpi": "The workspace's own word for the thing, and nothing else.",
    "newMenu.objective":
      "The workspace's own word for the thing, and nothing else.",
    "newMenu.space":
      "The workspace's own word for the thing, and nothing else.",
    "goals.filter.chip":
      '"Group: value", two holes and a colon. Nothing to translate.',
    "workMap.goalKeyResult":
      "A line made only of holes and a slash: the workspace's own words for the two things the column holds. Nothing to translate.",
    "workMap.keyResult":
      "A line made only of holes and a slash: the workspace's own words for the two things the column holds. Nothing to translate.",
    "workMap.objective":
      "A line made only of holes and a slash: the workspace's own words for the two things the column holds. Nothing to translate.",
    "spaces.role.coordinator":
      'The coordinator role is the term\'s own hole, like "common.caution".',
    "workMap.scope.cycle":
      "The Work Map's two pickers are named by the term's own hole.",
    "workMap.scope.space":
      "The Work Map's two pickers are named by the term's own hole.",
    "okrList.champion":
      "The owner column heading is the champion term's own hole.",
    "workMapHeader.outdatedUnit.one":
      "The Outdated stat's unit is the objective term's own hole.",
    "workMapHeader.outdatedUnit.other":
      "The Outdated stat's unit is the objective term's own hole.",
  },
};

/** Server-only exceptions, checked against the server message catalogue. */
export const SERVER_SAME_AS_ENGLISH: Record<string, Record<string, string>> = {
  ms: {
    "nudge.champion":
      "The server keeps the Champion role title in Malay (languages section 13).",
    "nudge.coach":
      "The server keeps the Coach role title in Malay (languages section 13).",
  },
};
