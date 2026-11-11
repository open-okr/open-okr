/**
 * The DnsResolver port (docs/design/sso-domain-verification.md, rule 5).
 *
 * **Why a port and not `node:dns` in core.** Proving that a workspace owns a
 * domain means asking public DNS for a TXT record. That is an outbound
 * lookup, so it belongs where the air-gap checklist can see it, and a test
 * must be able to answer it without a network.
 *
 * **Two outcomes and one exception.** A name with no TXT record is an answer,
 * and the driver returns an empty list for it. A resolver that did not answer
 * (timeout, server failure, no network) is not an answer about the domain:
 * the driver throws `DnsLookupError`, and the caller decides what an outage
 * means. An air-gapped instance is the case where every lookup throws, which
 * is why an administrator may mark a domain verified by hand.
 */

export interface DnsResolver {
  /**
   * The TXT records at `name`. Each record is a list of strings because DNS
   * splits a long record into 255-byte chunks, and the caller joins them.
   * An empty list means the name has no TXT record.
   */
  resolveTxt(name: string): Promise<string[][]>;
}

export class DnsLookupError extends Error {
  override readonly name = "DnsLookupError";
}
