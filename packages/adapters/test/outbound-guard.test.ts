import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import {
  checkUrl,
  createGuardedFetch,
  isBlockedAddress,
  OutboundRefusedError,
  outboundFetch,
  pinnedLookup,
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

  it("blocks every IPv6 form that embeds a private IPv4 address", () => {
    for (const address of [
      "::ffff:a9fe:a9fe",
      "::ffff:7f00:1",
      "::a9fe:a9fe",
      "::ffff:0:a9fe:a9fe",
      "64:ff9b::a9fe:a9fe",
      "64:ff9b::7f00:1",
      "2002:a9fe:a9fe::1",
      "2002:7f00:1::",
      "2001:0:4136:e378::1",
      "fe90::1",
      "febf::1",
      "fec0::1",
      "[::ffff:a9fe:a9fe]",
      "fe80::1%eth0",
    ]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  it("allows IPv6 addresses that embed a public IPv4 address", () => {
    for (const address of [
      "2606:4700:4700::1111",
      "2001:4860:4860::8888",
      "64:ff9b::808:808",
      "2002:808:808::1",
      "::ffff:808:808",
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

  it("refuses a literal IPv6 address that embeds a private IPv4 address", async () => {
    const outcome = await checkUrl("http://[::ffff:169.254.169.254]/", {
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

/**
 * The same checks as a `fetch` a provider SDK can be handed (completeness
 * review H-07). A model's answer streams, so this cannot buffer the way
 * `outboundFetch` does; it checks the address and refuses redirects, and
 * leaves the body alone.
 */
describe("createGuardedFetch", () => {
  const answering =
    (status = 200, headers: Record<string, string> = {}) =>
    async () =>
      new Response("streamed", { status, headers });

  it("refuses a private address before any request is made", async () => {
    let called = false;
    const guarded = createGuardedFetch({
      fetchImpl: async () => {
        called = true;
        return new Response("");
      },
    });
    await expect(
      guarded("http://169.254.169.254/latest/meta-data/"),
    ).rejects.toBeInstanceOf(OutboundRefusedError);
    expect(called).toBe(false);
  });

  it("refuses a public name that resolves to a private address", async () => {
    const guarded = createGuardedFetch({
      fetchImpl: answering(),
      resolve: resolves({ "llm.example.com": ["10.0.0.7"] }),
    });
    await expect(
      guarded("https://llm.example.com/v1/chat/completions"),
    ).rejects.toMatchObject({ refusal: "address_not_allowed" });
  });

  it("refuses a redirect rather than following it", async () => {
    const guarded = createGuardedFetch({
      fetchImpl: answering(302, { location: "http://127.0.0.1/" }),
      resolve: resolves({ "llm.example.com": ["93.184.216.34"] }),
    });
    await expect(
      guarded("https://llm.example.com/v1/models"),
    ).rejects.toMatchObject({ refusal: "redirected" });
  });

  it("passes an allowed request through with its body untouched", async () => {
    const guarded = createGuardedFetch({
      fetchImpl: answering(),
      resolve: resolves({ "llm.example.com": ["93.184.216.34"] }),
    });
    const response = await guarded(
      new URL("https://llm.example.com/v1/chat/completions"),
      { method: "POST", body: "{}" },
    );
    expect(await response.text()).toBe("streamed");
  });
});

/**
 * A webhook's request (docs/design/outbound-webhooks.md W7 and Q1): a POST
 * with a body, an answer read up to a cap and thrown away, and an instance
 * that may let hooks reach its own network but never its metadata service.
 */
describe("a webhook's request", () => {
  const publicResolve = resolves({ "hooks.example": ["93.184.216.34"] });

  it("posts the body it is given", async () => {
    let seen: RequestInit | undefined;
    const outcome = await outboundFetch("https://hooks.example/in", {
      resolve: publicResolve,
      method: "POST",
      body: '{"type":"ping"}',
      fetchImpl: async (_input, init) => {
        seen = init;
        return new Response(null, { status: 204 });
      },
    });
    expect(outcome).toMatchObject({ ok: true, status: 204 });
    expect(seen?.method).toBe("POST");
    expect(seen?.body).toBe('{"type":"ping"}');
    expect(seen?.redirect).toBe("manual");
  });

  it("keeps a long answer's status and reads only the first part of it", async () => {
    const outcome = await outboundFetch("https://hooks.example/in", {
      resolve: publicResolve,
      method: "POST",
      maxBytes: 10,
      truncate: true,
      fetchImpl: async () =>
        new Response("y".repeat(5_000), {
          status: 200,
          headers: { "content-length": "5000" },
        }),
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.status).toBe(200);
      expect(outcome.body.length).toBe(10);
    }
  });

  it("refuses a private address unless private targets are allowed", async () => {
    const internal = resolves({ "intranet.example": ["10.0.0.9"] });
    expect(
      await checkUrl("http://intranet.example/hook", { resolve: internal }),
    ).toMatchObject({ ok: false, refusal: "address_not_allowed" });
    expect(
      await checkUrl("http://intranet.example/hook", {
        resolve: internal,
        allowPrivate: true,
      }),
    ).toMatchObject({ ok: true });
    expect(
      await checkUrl("http://127.0.0.1:4000/hook", { allowPrivate: true }),
    ).toMatchObject({ ok: true });
    expect(
      await checkUrl("http://localhost:4000/hook", {
        allowPrivate: true,
        resolve: resolves({ localhost: ["127.0.0.1"] }),
      }),
    ).toMatchObject({ ok: true });
  });

  it("refuses the metadata services even where private targets are allowed", async () => {
    for (const candidate of [
      "http://169.254.169.254/latest/meta-data/",
      "http://100.100.100.200/latest/meta-data/",
      "http://[fd00:ec2::254]/latest/meta-data/",
      "http://[::ffff:169.254.169.254]/",
      "http://[fe80::1]/",
      "http://metadata.google.internal/computeMetadata/v1/",
    ]) {
      expect(
        await checkUrl(candidate, { allowPrivate: true }),
        candidate,
      ).toMatchObject({ ok: false });
    }
    expect(
      await checkUrl("https://sneaky.example/", {
        allowPrivate: true,
        resolve: resolves({
          "sneaky.example": ["10.0.0.1", "169.254.169.254"],
        }),
      }),
    ).toMatchObject({ ok: false, refusal: "address_not_allowed" });
  });
});

/**
 * DNS rebinding (docs/design/hardening-batch-2026-11.md H-C). A name that
 * answers with an allowed address for the check and a forbidden one when the
 * connection resolves it again must not reach the forbidden one.
 */
describe("connecting only to a checked address", () => {
  const listen = async (seen: string[]) => {
    const server = createServer((req, res) => {
      seen.push(String(req.headers.host));
      res.end("pinned");
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    return { server, port: (server.address() as AddressInfo).port };
  };

  it("never asks the resolver a second time, so a rebinding answer is not used", async () => {
    const seen: string[] = [];
    const { server, port } = await listen(seen);
    let calls = 0;
    // First answer is the one that is checked; every later one is the metadata
    // address a rebinding attacker wants the connection to reach.
    const resolve = async () => {
      calls += 1;
      return calls === 1 ? ["127.0.0.1"] : ["169.254.169.254"];
    };
    try {
      const result = await outboundFetch(`http://rebind.test:${port}/doc`, {
        resolve,
        allowPrivate: true,
      });
      expect(result).toMatchObject({ ok: true, body: "pinned" });
      expect(calls).toBe(1);
      // The hostname, not the address, stays in the Host header.
      expect(seen).toEqual([`rebind.test:${port}`]);
    } finally {
      server.close();
    }
  });

  it("uses the same pinned connection for a guarded fetch", async () => {
    const seen: string[] = [];
    const { server, port } = await listen(seen);
    let calls = 0;
    const guarded = createGuardedFetch({
      allowPrivate: true,
      resolve: async () => {
        calls += 1;
        return calls === 1 ? ["127.0.0.1"] : ["169.254.169.254"];
      },
    });
    try {
      const response = await guarded(`http://rebind.test:${port}/v1`);
      expect(await response.text()).toBe("pinned");
      expect(calls).toBe(1);
    } finally {
      server.close();
    }
  });

  it("answers a lookup with checked addresses only", () => {
    const lookup = pinnedLookup(["93.184.216.34", "2606:4700::1111"]);
    let single: unknown;
    lookup("anything.test", {}, (_e, address, family) => {
      single = [address, family];
    });
    expect(single).toEqual(["93.184.216.34", 4]);
    let all: unknown;
    lookup("anything.test", { all: true }, (_e, list) => {
      all = list;
    });
    expect(all).toEqual([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:4700::1111", family: 6 },
    ]);
  });
});
