/**
 * The browser's language, from its `Accept-Language` header (Q-8, plan
 * 0.8.1).
 *
 * A signed-out page has no member and no workspace to ask, so it asks the
 * browser first. Pure, so the rules below are tested without a request.
 *
 * **What the header looks like.** `ms-MY,ms;q=0.9,en-US;q=0.8,en;q=0.7`: a
 * list of language ranges, each with an optional weight `q` from 0 to 1 (RFC
 * 9110 §12.5.4). No weight is 1, a weight of 0 means "not this one", and equal
 * weights keep the order the browser sent them in.
 *
 * **Malformed parts are dropped, never guessed at.** A range that is not
 * letters, digits and hyphens, or a weight that is not a number from 0 to 1
 * with at most three decimals, removes that one part and keeps the rest. The
 * header is whatever the client chose to send.
 */

/** More than any browser sends, and a bound on what a hostile one costs. */
const MOST_PARTS = 32;

const RANGE = /^(?:\*|[a-z]{1,8}(?:-[a-z0-9]{1,8})*)$/;
const WEIGHT = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/;

/** The language ranges the header asks for, most wanted first, lower-cased. */
export function acceptedLanguages(
  header: string | null | undefined,
): readonly string[] {
  if (!header) {
    return [];
  }
  const parts: { range: string; weight: number; order: number }[] = [];
  const listed = header.split(",").slice(0, MOST_PARTS);
  for (const [order, part] of listed.entries()) {
    const [rawRange = "", ...parameters] = part.split(";");
    const range = rawRange.trim().toLowerCase();
    if (!RANGE.test(range)) {
      continue;
    }
    let weight = 1;
    let malformed = false;
    for (const parameter of parameters) {
      const [name = "", value = ""] = parameter.split("=");
      if (name.trim().toLowerCase() !== "q") {
        continue;
      }
      const written = value.trim();
      if (!WEIGHT.test(written)) {
        malformed = true;
        break;
      }
      weight = Number(written);
    }
    if (malformed || weight === 0) {
      continue;
    }
    parts.push({ range, weight, order });
  }
  return parts
    .sort((a, b) => b.weight - a.weight || a.order - b.order)
    .map((part) => part.range);
}

/**
 * The first language the browser asks for that the product ships, or null.
 *
 * A range matches on its primary language, so `ms-MY` is Malay and `en-GB`
 * English. `*` ("anything") names no language, so it never picks one: the
 * caller's own fallback, the instance's language, is a better answer to
 * "anything" than whichever catalogue happens to be listed first.
 */
export function browserLocale<L extends string>(
  header: string | null | undefined,
  shipped: readonly L[],
): L | null {
  for (const range of acceptedLanguages(header)) {
    if (range === "*") {
      continue;
    }
    const primary = range.split("-")[0];
    const match = shipped.find((locale) => locale === primary);
    if (match) {
      return match;
    }
  }
  return null;
}
