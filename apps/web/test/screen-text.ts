import { readFileSync } from "node:fs";
import { CATALOGUES } from "@openokr/ui";

/**
 * What a screen says, read from its source (P6-G22c).
 *
 * **Several tests assert on a phrase a screen shows**, by reading the file and
 * matching the words in it. That worked while the words were in the file. They
 * are in the catalogue now, and the file holds `t("admin.ai.worksWithAiOff")`
 * where it used to hold the sentence, so those assertions stopped seeing
 * anything.
 *
 * The assertions were not wrong; their subject moved. This resolves every
 * `t("…")` in a file back to its English text, so a test still asks the
 * question it was written to ask: does this screen say that. The alternative,
 * asserting on key names, would pass while the screen said nothing at all.
 *
 * A key with no catalogue entry is left as it is rather than raising: the file
 * may hold a `t` from somewhere else, and `catalogue-coverage.test.ts` is
 * where a missing key is caught.
 */
export function readScreen(path: string): string {
  const source = readFileSync(path, "utf8");
  const en = CATALOGUES.en;
  return source.replace(
    /\bt\(\s*"([^"]+)"\s*\)/g,
    (whole, key: string) => en[key] ?? whole,
  );
}

/**
 * A source file followed by the English of every catalogue key it names,
 * with or without values (completeness review M-15).
 *
 * `readScreen` only fills a `t("key")` that takes no values. The sweep that
 * moved the last 461 hardcoded strings into the catalogue turned sentences
 * several tests asserted on into keys with holes, and some into one/other
 * pairs. A test that asks "does this screen say X" asks it of this; a test
 * about the code itself keeps reading the source.
 */
export function withMessages(source: string): string {
  const en = CATALOGUES.en;
  const named = [
    ...source.matchAll(/"([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+)"/g),
  ]
    .map((match) => match[1] ?? "")
    .filter((key) => key in en);
  return [source, ...named.map((key) => en[key])].join("\n");
}
