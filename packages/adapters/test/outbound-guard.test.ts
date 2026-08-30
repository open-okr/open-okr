import { describe, expect, it } from "vitest";
import {
  checkUrl,
  isBlockedAddress,
  outboundFetch,
} from "../src/outbound/guard.ts";

/**
 * The rules every outbound fetch obeys (TECHNICAL-PLAN.md §11, P5-T08b).
 *
 * Each test here is one way a URL somebody else chose could be turned into a
 * read of the private network the server sits in. The cloud metadata address is
 * the sharpest: a plain GET returns credentials, with no authentication, because
 * the service assumes only the instance can reach it.
 */

/** A resolver a test controls, so no name server is ever asked. */
const resolves =
  (map: Record<string, string[]>) =>
  async (host: string): Promise<readonly string[]> =>
    map[host] ?? [];

describe("addresses a server must never be talked into reaching", () => {
  it("blocks loopback, private, link-local and metadata ranges", () => {
    for (const address of [
      "127.0.0.1",
      "127.1.2.3",
      "10.0.0.5",
      "172.16.0.1",
      "172.31.255.254",
      "192.168.1.1",
      // The one that returns credentials on most hosting.
      "169.254.169.254",
      "0.0.0.0",
      "100.64.0.1",
      "224.0.0.1",
      "::1",
      "fe80::1",
      "fd00::1",
      // An IPv4 address wearing an IPv6 hat reaches the same host.
      "::ffff:169.254.169.254",
    ]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  it("allows ordinary public addresses", () => {
    for (const address of [
      "1.1.1.1",
      "93.184.216.34",
      "172.32.0.1",
      "2606:4700::1111",
    ]) {
      expect(isBlockedAddress(address), address).toBe(false);
    }
  });

  it("refuses anything that is not an address at all", () => {
    expect(isBlockedAddress("not-an-address")).toBe(true);
    expect(isBlockedAddress("")).toBe(true);
  });
});

describe("checking a URL before fetching it", () => {
  it("refuses a scheme that is not http or https", async () => {
    for (const url of [
      "file:///etc/passwd",
      "gopher://example.test/",
      "ftp://example.test/",
    ]) {
      const outcome = await checkUrl(url);
      expect(outcome.ok, url).toBe(false);
      if (!outcome.ok) {
        expect(outcome.refusal).toBe("scheme_not_allowed");
      }
    }
  });

  it("refuses a literal private address without asking a resolver", async () => {
    const outcome = await checkUrl("http://169.254.169.254/latest/meta-data/", {
      // Asking would give a name server a say it should not have. If this ran,
      // the empty answer would produce "unreachable" rather than the refusal
      // the assertion below expects.
      resolve: async () => ["1.1.1.1"],
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.refusal).toBe("address_not_allowed");
    }
  });

  it("refuses a public name that resolves somewhere private", async () => {
    const outcome = await checkUrl("https://evil.test/metadata", {
      resolve: resolves({ "evil.test": ["10.0.0.5"] }),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.refusal).toBe("address_not_allowed");
      // Names the address, so an operator reading a log knows why.
      expect(outcome.detail).toContain("10.0.0.5");
    }
  });

  it("refuses a name with one public and one private answer", async () => {
    // The whole trick: a check that stops at the first allowed address lets the
    // connection pick the other one.
    const outcome = await checkUrl("https://mixed.test/doc", {
      resolve: resolves({ "mixed.test": ["93.184.216.34", "169.254.169.254"] }),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.refusal).toBe("address_not_allowed");
    }
  });

  it("refuses localhost by name as well as by address", async () => {
    const outcome = await checkUrl("http://localhost:3000/", {
      resolve: resolves({ localhost: ["93.184.216.34"] }),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.refusal).toBe("host_not_allowed");
    }
  });

  it("refuses a name that resolves nowhere", async () => {
    const outcome = await checkUrl("https://nothing.test/doc", {
      resolve: resolves({}),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.refusal).toBe("unreachable");
    }
  });

  it("allows an ordinary public document", async () => {
    const outcome = await checkUrl("https://agent.example/.well-known/oauth", {
      resolve: resolves({ "agent.example": ["93.184.216.34"] }),
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.checked.addresses).toEqual(["93.184.216.34"]);
    }
  });
});

describe("fetching", () => {
  const publicResolve = resolves({ "agent.example": ["93.184.216.34"] });
  const url = "https://agent.example/doc";

  it("reads a small document and reports its type", async () => {
    const outcome = await outboundFetch(url, {
      resolve: publicResolve,
      fetchImpl: async () =>
        new Response('{"client_name":"An agent"}', {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.body).toContain("An agent");
      expect(outcome.contentType).toContain("application/json");
    }
  });

  it("refuses a redirect rather than following it", async () => {
    // One hop reaches anything the address checks refused.
    const outcome = await outboundFetch(url, {
      resolve: publicResolve,
      fetchImpl: async () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/" },
        }),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.refusal).toBe("redirected");
    }
  });

  it("asks for a manual redirect, so the runtime cannot follow one for it", async () => {
    let seen: RequestInit | undefined;
    await outboundFetch(url, {
      resolve: publicResolve,
      fetchImpl: async (_input, init) => {
        seen = init;
        return new Response("{}", { status: 200 });
      },
    });
    expect(seen?.redirect).toBe("manual");
  });

  it("refuses a document that declares itself too large", async () => {
    const outcome = await outboundFetch(url, {
      resolve: publicResolve,
      maxBytes: 100,
      fetchImpl: async () =>
        new Response("{}", {
          status: 200,
          headers: { "content-length": "999999" },
        }),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.refusal).toBe("too_large");
    }
  });

  it("refuses one that understates its length and streams past the cap", async () => {
    // A hostile server is free to lie about content-length or omit it, which is
    // why the cap is enforced on what actually arrives.
    const outcome = await outboundFetch(url, {
      resolve: publicResolve,
      maxBytes: 10,
      fetchImpl: async () => new Response("x".repeat(5_000), { status: 200 }),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.refusal).toBe("too_large");
    }
  });

  it("gives up rather than waiting forever", async () => {
    const outcome = await outboundFetch(url, {
      resolve: publicResolve,
      timeoutMs: 20,
      fetchImpl: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.refusal).toBe("timed_out");
    }
  });

  it("never calls fetch at all for an address it refuses", async () => {
    let called = false;
    const outcome = await outboundFetch("http://10.0.0.5/admin", {
      fetchImpl: async () => {
        called = true;
        return new Response("{}", { status: 200 });
      },
    });
    expect(outcome.ok).toBe(false);
    expect(called).toBe(false);
  });
});
