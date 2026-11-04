/**
 * The providers anybody can get an address at for free (docs/design/
 * registration-policy.md §2.1).
 *
 * Two decisions read it: whether an address may start a workspace when
 * registration is open to company addresses only, and whether a domain may be
 * trusted. One list, so the two cannot disagree.
 *
 * Matched on the whole domain after the "@", lower-cased. A subdomain of a
 * listed domain does not match: nobody has an address at `mail.gmail.com`,
 * and a company may well run `gmail.acme.com`.
 *
 * A list somebody keeps current, not a rule of the method, which is why it is
 * here and not in METHOD.md.
 */
export const FREE_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.id",
  "yahoo.co.uk",
  "ymail.com",
  "rocketmail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "gmx.com",
  "gmx.net",
  "mail.com",
  "yandex.com",
  "yandex.ru",
  "zoho.com",
]);

/** Whether `domain` is a free mail provider. Case and spaces are ignored. */
export function isFreeMailDomain(domain: string): boolean {
  return FREE_MAIL_DOMAINS.has(domain.trim().toLowerCase());
}

/** Whether `address` is at a free mail provider. An address with no @ is not. */
export function isFreeMailAddress(address: string): boolean {
  const at = address.lastIndexOf("@");
  return at !== -1 && isFreeMailDomain(address.slice(at + 1));
}
