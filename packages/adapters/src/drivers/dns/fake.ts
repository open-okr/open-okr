/**
 * A DNS resolver that answers from a table, for tests and for a host that
 * wants to prove the verification path without a network.
 *
 * A name that is not in the table has no record. `fail()` makes every lookup
 * throw, which is what a resolver outage looks like to the caller.
 */
import { DnsLookupError, type DnsResolver } from "../../ports/dns.ts";

export class FakeDnsResolver implements DnsResolver {
  private readonly records = new Map<string, string[][]>();
  private failing = false;
  /** Every name asked about, in order. */
  readonly lookups: string[] = [];

  /** Publishes one TXT record at `name`. Names compare lower-cased. */
  publish(name: string, ...chunks: string[]): this {
    const key = name.toLowerCase();
    this.records.set(key, [...(this.records.get(key) ?? []), chunks]);
    return this;
  }

  /** Removes every TXT record at `name`. */
  remove(name: string): this {
    this.records.delete(name.toLowerCase());
    return this;
  }

  /** Makes lookups throw (true) or answer again (false). */
  fail(failing = true): this {
    this.failing = failing;
    return this;
  }

  async resolveTxt(name: string): Promise<string[][]> {
    this.lookups.push(name);
    if (this.failing) {
      throw new DnsLookupError(`The lookup of ${name} did not complete.`);
    }
    return this.records.get(name.toLowerCase()) ?? [];
  }
}
