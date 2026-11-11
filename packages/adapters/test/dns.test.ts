import { describe, expect, it } from "vitest";
import { FakeDnsResolver } from "../src/drivers/dns/fake.ts";
import { NodeDnsResolver } from "../src/drivers/dns/node.ts";
import { DnsLookupError } from "../src/ports/dns.ts";

/**
 * The DNS port (docs/design/sso-domain-verification.md, rule 5).
 *
 * The node driver is tested only for the part that needs no network: a name
 * under `.invalid` (RFC 6761) can never resolve, and a resolver pointed at a
 * closed local port never answers. The two are different outcomes and the
 * caller depends on the difference.
 */

describe("the fake resolver", () => {
  it("answers from its table, names lower-cased", async () => {
    const dns = new FakeDnsResolver().publish(
      "_openokr-verify.Example.com",
      "openokr-verify=abc",
    );

    expect(await dns.resolveTxt("_openokr-verify.example.com")).toEqual([
      ["openokr-verify=abc"],
    ]);
    expect(await dns.resolveTxt("_openokr-verify.other.com")).toEqual([]);
    expect(dns.lookups).toHaveLength(2);
  });

  it("throws when told it is down, and answers again afterwards", async () => {
    const dns = new FakeDnsResolver().fail();
    await expect(dns.resolveTxt("a.example")).rejects.toBeInstanceOf(
      DnsLookupError,
    );
    dns.fail(false);
    expect(await dns.resolveTxt("a.example")).toEqual([]);
  });
});

describe("the node driver", () => {
  it("reports a resolver that did not answer as a lookup error, not as no record", async () => {
    // A closed local port: the query is sent and nothing replies.
    const dns = new NodeDnsResolver({
      timeoutMs: 300,
      servers: ["127.0.0.1:1"],
    });

    await expect(dns.resolveTxt("example.com")).rejects.toBeInstanceOf(
      DnsLookupError,
    );
  });
});
