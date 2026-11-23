import type { LocaleCode } from "@openokr/core";

/** Synthetic prose for checking language independently of each reply schema. */
export const LOCALE_REPLIES: Readonly<Record<LocaleCode, string>> = {
  en: "The team is improving the result.",
  ms: "Pasukan sedang memperbaik hasil ini.",
  "zh-Hans": "团队正在改善结果。",
  es: "El equipo está mejorando el resultado.",
  ar: "يعمل الفريق على تحسين النتيجة.",
  de: "Das Team arbeitet an einem besseren Ergebnis.",
  pt: "A equipe está melhorando o resultado.",
  fr: "L’équipe travaille sur un meilleur résultat.",
  it: "Il gruppo sta migliorando il risultato.",
  id: "Tim sedang memperbaiki hasil ini.",
};

const PROSE_FIELDS = new Set([
  "anomalies",
  "description",
  "narrative",
  "notes",
  "openQuestions",
  "reason",
  "rewritten",
  "summary",
  "tasks",
  "text",
  "title",
  "why",
]);

/** Visit prose while retaining numeric values, references and other schema data. */
export function mapProse(
  value: unknown,
  map: (text: string) => string,
  field?: string,
): unknown {
  if (typeof value === "string") {
    return value.trim() && (field === undefined || PROSE_FIELDS.has(field))
      ? map(value)
      : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => mapProse(item, map, field));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        mapProse(item, map, key),
      ]),
    );
  }
  return value;
}

const SCRIPTS = {
  "zh-Hans": /\p{Script=Han}/u,
  ar: /\p{Script=Arabic}/u,
};

const STOP_WORDS = {
  en: ["the", "and", "is", "that", "with", "from", "for", "of", "to", "in"],
  ms: [
    "yang",
    "dan",
    "untuk",
    "dengan",
    "daripada",
    "pada",
    "sedang",
    "ialah",
    "adalah",
  ],
  es: ["el", "la", "los", "las", "del", "que", "para", "con", "está"],
  de: ["der", "die", "das", "den", "dem", "und", "einem", "für", "mit"],
  pt: ["o", "a", "os", "as", "do", "da", "das", "dos", "não", "uma", "com"],
  fr: [
    "le",
    "la",
    "les",
    "des",
    "du",
    "et",
    "dans",
    "un",
    "une",
    "avec",
    "sur",
  ],
  it: ["il", "lo", "gli", "della", "del", "delle", "dei", "per", "nel", "con"],
  id: [
    "yang",
    "dan",
    "untuk",
    "dengan",
    "dari",
    "pada",
    "adalah",
    "akan",
    "sedang",
  ],
};

export function matchesReplyLanguage(
  result: unknown,
  locale: LocaleCode,
  live: boolean,
): boolean {
  const prose: string[] = [];
  mapProse(result, (text) => {
    prose.push(text);
    return text;
  });
  const text = prose.join(" ");
  if (locale === "zh-Hans" || locale === "ar") {
    return SCRIPTS[locale].test(text);
  }
  if (!live) {
    return true;
  }
  const words = new Set(text.toLowerCase().match(/\p{L}+/gu));
  return STOP_WORDS[locale].some((word) => words.has(word));
}
