const LETTER = /\p{L}/u;
const HAN_OR_ARABIC = /[\p{Script=Han}\p{Script=Arabic}]/u;

/** English word lists are skipped when most of the letters are Han or Arabic. */
export function skipsEnglishWordChecks(text: string): boolean {
  let letters = 0;
  let hanOrArabic = 0;
  for (const character of text) {
    if (LETTER.test(character)) {
      letters += 1;
      if (HAN_OR_ARABIC.test(character)) hanOrArabic += 1;
    }
  }
  return hanOrArabic * 2 > letters;
}

export function normaliseArabicIndicDigits(text: string): string {
  return text.replace(/[\u0660-\u0669\u06f0-\u06f9]/g, (digit) => {
    const code = digit.charCodeAt(0);
    const zero = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(code - zero);
  });
}
