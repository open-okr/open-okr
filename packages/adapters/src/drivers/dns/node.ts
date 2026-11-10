/**
 * The DNS driver, on Node's own resolver (docs/design/
 * sso-domain-verification.md, rule 5).
 *
 * **`node:dns/promises` and nothing else**, so no dependency. One try with a
 * short timeout: a verification is somebody pressing a button, and the daily
 * re-check can afford to wait for tomorrow, so neither is worth a slow retry.
 *
 * **"No record" and "no answer" are kept apart.** `ENOTFOUND` and `ENODATA`
 * say the name has no TXT record, which is an answer. Anything else (a
 * timeout, `SERVFAIL`, a refused query, no network) says nothing about the
 * domain and is thrown as `DnsLookupError`.
 */
import { Resolver } from "node:dns/promises";
import { DnsLookupError, type DnsResolver } from "../../ports/dns.ts";

export interface NodeDnsResolverOptions {
  /** How long one lookup may take. Defaults to five seconds. */
  readonly timeoutMs?: number;
  /** Resolver addresses, for an instance that must not use the host's. */
  readonly servers?: readonly string[];
}

const NO_RECORD = new Set(["ENOTFOUND", "ENODATA"]);

export class NodeDnsResolver implements DnsResolver {
  private readonly timeoutMs: number;
  private readonly servers: readonly string[] | undefined;

  constructor(options: NodeDnsResolverOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.servers = options.servers;
  }

  async resolveTxt(name: string): Promise<string[][]> {
    const resolver = new Resolver({ timeout: this.timeoutMs, tries: 1 });
    if (this.servers && this.servers.length > 0) {
      resolver.setServers([...this.servers]);
    }
    try {
      return await resolver.resolveTxt(name);
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (typeof code === "string" && NO_RECORD.has(code)) {
        return [];
      }
      throw new DnsLookupError(
        `The lookup of ${name} did not complete${
          typeof code === "string" ? ` (${code})` : ""
        }.`,
        { cause: error },
      );
    }
  }
}
