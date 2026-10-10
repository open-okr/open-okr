/**
 * An email address, as the server accepts one.
 *
 * zod's own pattern, the one `z.email()` applies by default, copied rather
 * than imported so the browser carries no schema library to check one field.
 * A test fails if zod's pattern changes. It is stricter than the browser's own
 * `type="email"`, which accepts `priya@northwind` with no top-level domain, so
 * a field checks with this and not with the browser's verdict alone.
 *
 * **Built from a string, character for character.** The API description
 * publishes the pattern's source, and the linter rewrites a regex literal's
 * redundant escapes, which kept the meaning and changed the published text.
 */
// biome-ignore lint/complexity/useRegexLiterals: a literal would have its escapes rewritten, and its source is published
export const EMAIL_PATTERN = new RegExp(
  String.raw`^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$`,
);

/** Whether `text`, already trimmed, is an email address the server accepts. */
export function isEmailAddress(text: string): boolean {
  return EMAIL_PATTERN.test(text);
}
