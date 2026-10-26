/**
 * A DNS-shaped domain, lower-cased: `mail.example.co`, not an email address
 * and not a web address. Moved unchanged from the trusted email domains
 * setting, which lower-cases before it checks.
 */
export const DOMAIN_PATTERN =
  /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

/** Whether `text`, already trimmed and lower-cased, is a domain. */
export function isDomain(text: string): boolean {
  return DOMAIN_PATTERN.test(text);
}
