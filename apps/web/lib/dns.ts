import { type DnsResolver, NodeDnsResolver } from "@openokr/adapters";

/**
 * Process-wide DNS resolver, for proving that a workspace owns an email domain
 * (docs/design/sso-domain-verification.md, rule 5).
 *
 * Node's own resolver and no configuration: an instance with no public DNS
 * simply fails the lookup, and an instance administrator marks the domain
 * verified by hand. Cached on `globalThis` for the reason `getStorage()` is.
 */
const globals = globalThis as typeof globalThis & {
  openokrDns?: DnsResolver;
};

export function getDns(): DnsResolver {
  globals.openokrDns ??= new NodeDnsResolver();
  return globals.openokrDns;
}
