import { describe, expect, it } from "vitest";
import { redirectAllowed } from "../src/api/oauth/clients.ts";
import {
  CHALLENGE_METHOD,
  challengeFor,
  isValidVerifier,
  verifierMatches,
} from "../src/api/oauth/pkce.ts";
import { kindFromText, mintSecret } from "../src/api/oauth/secrets.ts";

/**
 * The two checks that stand between a code and the wrong hands (P5-T08a).
 *
 * Neither needs a database, and both are the kind of thing that is wrong by one
 * character or not at all.
 */

const client = (uris: string[]) => ({ redirectUris: uris });

describe("which address a code may be sent to", () => {
  it("matches the whole address, never a prefix", () => {
    const registered = client(["https://agent.example/cb"]);
    expect(redirectAllowed(registered, "https://agent.example/cb")).toBeNull();
    // The classic: a prefix match here is a complete account takeover.
    expect(
      redirectAllowed(registered, "https://agent.example/cb.attacker.test"),
    ).toBe("redirect_not_registered");
    expect(redirectAllowed(registered, "https://agent.example/cb/more")).toBe(
      "redirect_not_registered",
    );
  });

  it("ignores the port on loopback, and only on loopback", () => {
    // RFC 8252 §7.3: a native application binds an ephemeral port, so the port
    // cannot be known when the client registered.
    const local = client(["http://127.0.0.1/callback"]);
    expect(
      redirectAllowed(local, "http://127.0.0.1:51234/callback"),
    ).toBeNull();
    expect(redirectAllowed(local, "http://127.0.0.1:9/callback")).toBeNull();
    // A different path is still a different address.
    expect(redirectAllowed(local, "http://127.0.0.1:51234/other")).toBe(
      "redirect_not_registered",
    );

    const remote = client(["https://agent.example/cb"]);
    expect(redirectAllowed(remote, "https://agent.example:8443/cb")).toBe(
      "redirect_not_registered",
    );
  });

  it("allows plain HTTP only to loopback", () => {
    expect(
      redirectAllowed(
        client(["http://agent.example/cb"]),
        "http://agent.example/cb",
      ),
    ).toBe("redirect_insecure");
    expect(
      redirectAllowed(
        client(["http://[::1]/callback"]),
        "http://[::1]:7777/callback",
      ),
    ).toBeNull();
  });

  it("refuses something that is not an address at all", () => {
    expect(
      redirectAllowed(client(["https://agent.example/cb"]), "not a url"),
    ).toBe("redirect_not_registered");
  });
});

describe("proof of key exchange", () => {
  it("accepts the verifier the challenge was derived from", () => {
    const verifier = "a".repeat(64);
    expect(
      verifierMatches({
        verifier,
        challenge: challengeFor(verifier),
        method: CHALLENGE_METHOD,
      }),
    ).toBe(true);
  });

  it("refuses any other verifier", () => {
    expect(
      verifierMatches({
        verifier: "b".repeat(64),
        challenge: challengeFor("a".repeat(64)),
        method: CHALLENGE_METHOD,
      }),
    ).toBe(false);
  });

  it("refuses the plain method, which protects against nothing", () => {
    const verifier = "a".repeat(64);
    expect(
      verifierMatches({ verifier, challenge: verifier, method: "plain" }),
    ).toBe(false);
  });

  it("refuses a verifier outside RFC 7636's length and alphabet", () => {
    expect(isValidVerifier("a".repeat(42))).toBe(false);
    expect(isValidVerifier("a".repeat(129))).toBe(false);
    expect(isValidVerifier(`${"a".repeat(43)} `)).toBe(false);
    expect(isValidVerifier("a".repeat(43))).toBe(true);
  });
});

describe("the secrets themselves", () => {
  it("carries a prefix that says which kind, and stores only a digest", () => {
    const code = mintSecret("code");
    expect(code.raw).toMatch(/^okr_code_/);
    expect(kindFromText(code.raw)).toBe("code");
    expect(code.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(code.raw).not.toContain(code.hash);
  });

  it("tells the three kinds apart, and refuses anything else", () => {
    expect(kindFromText(mintSecret("access").raw)).toBe("access");
    expect(kindFromText(mintSecret("refresh").raw)).toBe("refresh");
    // An API token is not one of these, which is what stops it being used here.
    expect(kindFromText("okr_rest_something")).toBeNull();
    expect(kindFromText("")).toBeNull();
  });

  it("never mints the same secret twice", () => {
    const seen = new Set(
      Array.from({ length: 50 }, () => mintSecret("access").raw),
    );
    expect(seen.size).toBe(50);
  });
});
