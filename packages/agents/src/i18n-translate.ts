import type { AIProvider } from "@openokr/adapters";
import { messageHasLetters } from "@openokr/core";

const HOLE_REGEX = /\{([a-zA-Z][a-zA-Z0-9]*)\}/g;
const TOKEN_REGEX = /⟦\d+⟧/g;
const HAN_REGEX = /\p{Script=Han}/u;
const ARABIC_REGEX = /\p{Script=Arabic}/u;

const SHORT_LABEL_INSTRUCTIONS: Readonly<Record<string, string>> = {
  "zh-Hans":
    "Use 人工智能 for a bare AI label and 目标与关键结果 for a bare OKR label. For a file size in KB, add 大小 before the quantity and keep KB. Preserve all placeholder tokens.",
  es: 'Use "Activo" for On, "Inactivo" for Off, "Vence" for Due, "Para" for By, "Fijar" for Set, and "Bandeja" for Inbox. Use "Correo" for Email and "Tecla Esc" for Esc. For unchanged cognates choose a natural Spanish alternative, such as "Ajustes" for General and "Plan actual" for Plan. Keep technical examples intact with a short label such as "Ej.:". Use "NO" for a bare No option.',
  pt: 'Write Brazilian Portuguese. Use "Início" for Home, "Ativo" or "Inativo" for On or Off, "Vence" for Due, "Definir" for Set, "E-mail" for Email, and "Tecla Esc" for Esc. For shared terms, name the purpose, such as "Plano atual", "Funções de acesso", "Webhooks de saída", or "Via OIDC". Preserve literal examples with an "Ex.:" prefix, file sizes with "Tamanho:", and command text inside quotation marks. Use "Em CSV" for CSV and "API REST" for REST.',
  ar: 'Use concise Modern Standard Arabic. For the glossary entry kpi, use exactly "مؤشر". Every requested value with written words needs an Arabic letter even when it contains a literal URL, email, code, acronym, certification, or keyboard shortcut. Keep the technical text intact and add a short Arabic label such as "مثال:" or "ملف". Use "الرئيسية" for Home, "ذكاء" for AI, "أهداف" for OKR, "مؤشر" for KPI, "يعمل" for On, "متوقف" for Off, "ضبط" for Set, "بريد" for Email, and "مفتاح Esc" for Esc. Use 0–9 for digits. Leave every placeholder token intact, including count tokens in plural categories.',
  de: 'Use concise natural German. For the glossary entry health.watch, use exactly "Achtung". For exports.column.initiative use exactly "Vorhaben", and for exports.column.kpi use exactly "Kennzahl". Use "Startseite" for Home, "Aktiv" or "Inaktiv" for On or Off, "Fällig" for Due, "Festlegen" for Set, "E-Mail" for Email, and "Esc-Taste" for Esc. Translate shared cognates with a descriptive German label, such as "Übersicht" for General, "Aktueller Tarif" for Plan, "Zugriffsrollen" for Roles, and "Ausgehende Webhooks" for Webhooks. Preserve literal examples with a short "Bsp.:" prefix, file sizes with "Größe:", command text inside quotation marks, and every placeholder token.',
  fr: 'Write natural French in a neutral register (infinitive or noun forms, no "vous" in labels). The validator rejects any value identical to the English one, so use these reviewed labels where French shares the English word: Document="Document texte", Documents="Documents texte", Initiative="Chantier", Initiatives="Chantiers", Session="Séance", Sessions="Séances", Type="Catégorie", Action="Opération", Actions="Opérations" (use "Actions à suivre" for meeting minutes), Message="Texte du message", Messages="Messages du site", Version="Numéro de version", "Version {version}"="Version n° {version}", "v{version}"="v. {version}", Impact="Effet", "Impact {x}"="Effet {x}", Mission="Raison d\'être", Vision="Vision d\'avenir", Agent="Agent IA", agent="agent IA", Phase="Étape", Source="Provenance", Sources="Références", Question="Question posée", Image="Visuel", Description="Descriptif", Direction="Sens", Distribution="Répartition", Stable="Constant", Notifications="Alertes", Participants="Personnes présentes", Invitation="Invitation à rejoindre", Invitations="Invitations envoyées", Information="Informatif", Incident="Panne ou incident", Compact="Resserré", Test="Essai", Code="Bloc de code", Info="Infos", Brand="Marque", Avatars="Photos de profil", Concept="Notion", points="pts", Points="Total de points", Verdict="Conclusion", Score="Résultat", Scores="Résultats", Cycle="Cycle OKR", Cycles="Cycles OKR", Section="Rubrique", Sponsor="Parrain", Sponsors="Parrains", Webhooks="Webhooks sortants", Page="Écran", Conversation="Échange", "Discussion ({length})"="Fil de discussion ({length})", "Tables ({length})"="Tables de données ({length})", Instance="Instance du serveur", Mute="Sourdine", Now="Actuel", move="Déplacer", Bio="À propos", By="Par", As="Comme", Rejoin="Revenir", "Promote it"="Promouvoir", Upgrade="Évoluer", "Ask AI"="Demander à l\'IA", Inbox="Réception", Off="Inactif", On="Actif", NOTE="REMARQUE", WARN="ALERTE", OBJ="OBJECTIF", OKR="Objectifs", AGENT="AGENT IA", Destructive="Destructif", REST="API REST", Vision capability="Analyse d\'images". Counts: initiative="{count} chantier"/"{count} chantiers", minute="{count} min" for every form, variable="{count} paramètre"/"{count} paramètres", version="{count} révision"/"{count} révisions", vote="{count} voix" for every form, document="{count} document texte"/"{count} documents texte", action="{count} mesure"/"{count} mesures". Use the same text for the "many" form as for the "other" form. Logo="Emblème", logo="emblème", OIDC="Via OIDC", CSV="En CSV". Every placeholder example (keys ending in Placeholder), the pnpm audit:verify command and a bare PEM header must keep their literal text after the prefix "Ex. : " (for the command, "Commande : "). Keep each placeholder token exactly once, as in the source. Preserve literal examples, URLs and commands inside quotation marks or with a short "Ex. :" prefix.',
  it: 'Write natural Italian in a neutral register (infinitive or noun forms in labels). The validator rejects any value identical to the English one or over three times its length, so use these reviewed labels for these exact English values: "REST"="API REST", "Password"="Password di accesso", "Off"="Inattivo", "On"="Attivo", "off"="inattivo", "on"="attivo", "pnpm audit:verify"="Comando pnpm audit:verify", "Sandbox"="Ambiente di prova", "view"="lettura", "View"="Lettura", "Streaming"="Flusso continuo", "api.openai.com"="Es.: api.openai.com", "Upgrade"="Aggiorna piano", "Favicon"="Icona sito", "favicon"="icona sito", "{name}, {size} KB"="File {name}, {size} KB", "Logo"="Marchio", "logo"="marchio", "Home"="Inizio", "File"="Documento", "{bytes} KB"="Dim.: {bytes} KB", "SHA-256"="Hash SHA-256", "example.com, example.org"="Es.: example.com, example.org", "OIDC"="Via OIDC", "SAML 2.0"="Via SAML 2.0", "OIDC (OpenID Connect)"="Via OIDC (OpenID Connect)", "No"="NO", "no"="NO", "Test"="Prova", "Backlog"="Da pianificare", "{tasks} in {name}."="{tasks} nello spazio {name}.", "email"="e-mail", "Email"="E-mail", "Esc"="Tasto Esc", "in {quarters}"="nei trimestri {quarters}", "In {where}"="Presso {where}", "{title} in {space}"="{title} nello spazio {space}", "Owned"="Assegnato", "Formula"="Calcolo", "Input"="Ingresso", "Output"="Uscita", "{hours}h {minutes}m"="{hours} h {minutes} min", "+ KR"="+ Nuovo KR", "of KRs"="di KR", "Tenant"="Cliente", "Storage"="Spazio disco", "CSV"="File CSV", "+ 1 min"="+ 1 minuto", "Demo"="Esempio", "v{version}"="v. {version}", "KPI"="Indice", "Sponsor"="Promotore", "OKR"="Obiettivi", "Account"="Profilo", "{count} gate"="{count} controllo", "Put 1 workspace on {plan}"="Assegna 1 area di lavoro a {plan}". For a literal example such as a URL, host or certificate marker, prefix "Es.: " and keep the literal. Preserve every placeholder.',
  id: 'Write natural Indonesian in a neutral register (noun or imperative forms in labels). The validator rejects any value identical to the English one or over three times its length, so use these reviewed labels for these exact English values: "REST"="API REST", "pnpm audit:verify"="Perintah pnpm audit:verify", "Sandbox"="Mode uji", "edit"="ubah", "Edit"="Ubah", "Streaming"="Pengaliran", "Model"="Model AI", "api.openai.com"="Contoh: api.openai.com", "Embedding"="Penyematan", "Target"="Nilai target", "target {target}"="nilai target {target}", "Favicon"="Ikon situs", "favicon"="ikon situs", "Logo"="Lambang", "logo"="lambang", "{name}, {size} KB"="Berkas {name}, {size} KB", "File"="Berkas", "{bytes} KB"="Ukuran: {bytes} KB", "SHA-256"="Hash SHA-256", "example.com, example.org"="Contoh: example.com, example.org", "Admin"="Administrator", "OIDC"="Melalui OIDC", "SAML 2.0"="Melalui SAML 2.0", "OIDC (OpenID Connect)"="Melalui OIDC (OpenID Connect)", "Single sign-on"="Masuk tunggal", "Edit {name}"="Ubah {name}", "Spreadsheet"="Lembar kerja", "Backlog"="Daftar tunggu", "email"="surel", "Email"="Surel", "Status"="Kondisi", "AI"="KA", "\u2728 AI"="\u2728 KA", "Enter"="Kunci Enter", "Esc"="Kunci Esc", "Owner"="Pemilik", "Copilot"="Kopilot", "Edit {termObjectiveLower}"="Ubah {termObjectiveLower}", "Warns"="Peringatan", "Info"="Informasi", "Diagram"="Bagan", "Filter"="Saring", "{count} item"="{count} butir", "+ KR"="+ Hasil", "Due"="Tenggat", "To do"="Daftar tugas", "Ritual"="Rutinitas", "Demo"="Contoh", "Detail"="Rincian", "v{version}"="v. {version}", "As"="Selaku", "Check-in"="Check-in berkala", "KPI"="Indikator", "Sponsor"="Penyokong", "OKR"="Sasaran", "CSV"="Via CSV". For a literal example such as a URL, host, certificate marker or provider id, prefix "Contoh: " and keep the literal. Preserve every placeholder.',
};

export function maskHoles(text: string): {
  readonly masked: string;
  readonly tokens: Map<string, string>;
} {
  const tokens = new Map<string, string>();
  let counter = 1;
  const masked = text.replace(HOLE_REGEX, (match) => {
    const token = `⟦${counter++}⟧`;
    tokens.set(token, match);
    return token;
  });
  return { masked, tokens };
}

export interface UnmaskResult {
  readonly success: boolean;
  readonly text?: string;
  readonly error?: string;
}

export function unmaskHoles(
  translated: string,
  tokens: Map<string, string>,
): UnmaskResult {
  const foundTokens = translated.match(TOKEN_REGEX) ?? [];
  const tokenCounts = new Map<string, number>();
  for (const t of foundTokens) {
    tokenCounts.set(t, (tokenCounts.get(t) ?? 0) + 1);
  }

  // Check expected tokens
  for (const token of tokens.keys()) {
    const count = tokenCounts.get(token) ?? 0;
    if (count === 0) {
      return { success: false, error: `dropped hole token ${token}` };
    }
    if (count > 1) {
      return { success: false, error: `duplicate hole token ${token}` };
    }
  }

  // Check unexpected tokens
  for (const token of foundTokens) {
    if (!tokens.has(token)) {
      return { success: false, error: `unexpected hole token ${token}` };
    }
  }

  // Restore tokens
  let unmasked = translated;
  for (const [token, original] of tokens.entries()) {
    unmasked = unmasked.replaceAll(token, original);
  }

  return { success: true, text: unmasked };
}

function extractHoles(text: string): readonly string[] {
  const matches = text.match(HOLE_REGEX) ?? [];
  return matches.map((m) => m.slice(1, -1)).sort();
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly error?: string;
}

export function validateTranslation(
  key: string,
  english: string,
  translated: string,
  locale: string,
  sameAsEnglish: Record<string, string> = {},
): ValidationResult {
  // 1. Length check: length at most 3 times English
  if (english.length > 0 && translated.length > english.length * 3) {
    return {
      valid: false,
      error: `length (${translated.length}) exceeds 3 times English length (${english.length * 3})`,
    };
  }

  // 2. Holes equal check
  const sourceHoles = extractHoles(english);
  const targetHoles = extractHoles(translated);
  if (
    sourceHoles.length !== targetHoles.length ||
    sourceHoles.some((h, i) => h !== targetHoles[i])
  ) {
    return {
      valid: false,
      error: `holes do not match English: expected [${sourceHoles.join(", ")}], got [${targetHoles.join(", ")}]`,
    };
  }

  // 3. Script checks
  if (locale === "zh-Hans" && !sameAsEnglish[key]) {
    if (messageHasLetters(english) && !HAN_REGEX.test(translated)) {
      return {
        valid: false,
        error: "Chinese translation contains no Han characters",
      };
    }
  }

  if (locale === "ar" && !sameAsEnglish[key]) {
    if (messageHasLetters(english) && !ARABIC_REGEX.test(translated)) {
      return {
        valid: false,
        error: "Arabic translation contains no Arabic characters",
      };
    }
  }

  return { valid: true };
}

export function chunkKeys(
  keys: readonly string[],
  batchSize = 100,
): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < keys.length; i += batchSize) {
    chunks.push(keys.slice(i, i + batchSize));
  }
  return chunks;
}

interface TranslateItemFailure {
  readonly key: string;
  readonly error: string;
}

export interface TranslateCatalogueOptions {
  readonly provider: AIProvider;
  readonly model: string;
  readonly locale: string;
  readonly keys: readonly string[];
  readonly sourceCatalogue: Record<string, string>;
  readonly targetCatalogue: Record<string, string>;
  readonly pendingKeys: readonly string[];
  readonly sameAsEnglish?: Record<string, string>;
  readonly glossary?: Record<string, string>;
  readonly requireTranslation?: boolean;
  readonly onProgress?: (message: string) => void;
}

export interface TranslateCatalogueResult {
  readonly translatedCount: number;
  readonly failedCount: number;
  readonly failures: readonly TranslateItemFailure[];
  readonly remainingPending: readonly string[];
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export async function translateCatalogue(
  options: TranslateCatalogueOptions,
): Promise<TranslateCatalogueResult> {
  const {
    provider,
    model,
    locale,
    keys,
    sourceCatalogue,
    targetCatalogue,
    pendingKeys,
    sameAsEnglish = {},
    glossary = {},
    requireTranslation = false,
    onProgress,
  } = options;

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let translatedCount = 0;
  const failures: TranslateItemFailure[] = [];
  const pendingSet = new Set(pendingKeys);

  const batches = chunkKeys(keys, 100);

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    if (!batch) {
      continue;
    }
    onProgress?.(
      `Translating batch ${batchIndex + 1} of ${batches.length} (${batch.length} keys)...`,
    );

    const maskedBatch: Record<string, string> = {};
    const tokensMap = new Map<string, Map<string, string>>();

    for (const key of batch) {
      const english = sourceCatalogue[key] ?? "";
      const { masked, tokens } = maskHoles(english);
      maskedBatch[key] = masked;
      tokensMap.set(key, tokens);
    }

    const glossarySection =
      Object.keys(glossary).length > 0
        ? `\nGlossary (use these exact terms when translating method concepts):\n${JSON.stringify(glossary, null, 2)}`
        : "";
    const script =
      locale === "zh-Hans" ? "Han" : locale === "ar" ? "Arabic" : undefined;
    const scriptRule =
      requireTranslation && script
        ? `\n4. Include at least one ${script} letter in each value with written words. Keep URLs, code, email addresses, acronyms, and keyboard shortcuts intact and add a short translated label where needed.`
        : "";
    const shortLabels = SHORT_LABEL_INSTRUCTIONS[locale];

    const systemPrompt = `You are an expert translator translating user interface text for OpenOKR into locale '${locale}'.
Rules:
1. Preserve placeholder tokens like ⟦1⟧, ⟦2⟧ exactly. Do not translate, alter, duplicate, or delete them.
2. Return ONLY a valid JSON object mapping each key to its translated string. Do not include markdown code fences or other prose.
3. Keep the translation concise, accurate, and natural for software UI. For catalogue entries that require translation, do not repeat the English value. Localize cognates with a natural regional label and keep any literal command, protocol, or example readable inside the translated value. The translation must fit within three times the length of the English value. Use short localized labels for standalone abbreviations, technical examples, and units.${scriptRule}${shortLabels ? `\n5. ${shortLabels}` : ""}${glossarySection}`;

    const userPrompt = JSON.stringify(maskedBatch, null, 2);

    const response = await provider.chat({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
      maxTokens: 8192,
      feature: "i18n:translate",
    });

    totalInputTokens += response.usage.inputTokens;
    totalOutputTokens += response.usage.outputTokens;

    let parsedReply: Record<string, string> = {};
    try {
      let content = response.content.trim();
      if (content.startsWith("```")) {
        content = content
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```$/, "");
      }
      parsedReply = JSON.parse(content) as Record<string, string>;
    } catch (err) {
      const parseError =
        err instanceof Error ? err.message : "Failed to parse JSON response";
      for (const key of batch) {
        failures.push({ key, error: parseError });
      }
      continue;
    }

    for (const key of batch) {
      const english = sourceCatalogue[key] ?? "";
      const tokens = tokensMap.get(key) ?? new Map();
      const rawTranslation = parsedReply[key];

      if (rawTranslation === undefined) {
        failures.push({ key, error: "key missing from translation response" });
        continue;
      }
      if (typeof rawTranslation !== "string") {
        failures.push({ key, error: "translation is not a string" });
        continue;
      }

      const unmasked = unmaskHoles(rawTranslation, tokens);
      if (!unmasked.success || unmasked.text === undefined) {
        failures.push({ key, error: unmasked.error ?? "unmask failed" });
        continue;
      }

      const validation = validateTranslation(
        key,
        english,
        unmasked.text,
        locale,
        sameAsEnglish,
      );
      if (!validation.valid) {
        failures.push({ key, error: validation.error ?? "validation failed" });
        continue;
      }
      if (
        requireTranslation &&
        !sameAsEnglish[key] &&
        messageHasLetters(english) &&
        (unmasked.text.trim() === "" || unmasked.text === english)
      ) {
        failures.push({ key, error: "the value needs a translation" });
        continue;
      }

      // Successful translation
      targetCatalogue[key] = unmasked.text;
      pendingSet.delete(key);
      translatedCount++;
    }
  }

  return {
    translatedCount,
    failedCount: failures.length,
    failures,
    remainingPending: Array.from(pendingSet).sort(),
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
  };
}
