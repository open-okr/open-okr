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
    const shortLabels = requireTranslation
      ? SHORT_LABEL_INSTRUCTIONS[locale]
      : undefined;

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
