/**
 * The cross-site check for cookie-authenticated route handlers (H-A).
 */
import { describe, expect, it, vi } from "vitest";
import { refuseCrossSite, sameOriginAllowed } from "../lib/same-origin";

vi.mock("../lib/issuer", () => ({
  instanceIssuer: () => "https://okr.example.test",
}));

const ISSUER = "https://okr.example.test";

const allowed = (headers: Record<string, string>) =>
  sameOriginAllowed(new Headers(headers), ISSUER);

describe("sameOriginAllowed", () => {
  it("accepts the instance's own origin", () => {
    expect(allowed({ origin: ISSUER })).toBe(true);
  });

  it("refuses another site", () => {
    expect(allowed({ origin: "https://evil.example" })).toBe(false);
  });

  it("refuses the literal null a sandboxed page sends", () => {
    expect(allowed({ origin: "null" })).toBe(false);
  });

  it("falls back to the referer when there is no origin", () => {
    expect(allowed({ referer: `${ISSUER}/admin/sso` })).toBe(true);
    expect(allowed({ referer: "https://evil.example/page" })).toBe(false);
  });

  it("prefers the origin over the referer", () => {
    expect(
      allowed({ origin: "https://evil.example", referer: `${ISSUER}/x` }),
    ).toBe(false);
  });

  it("lets a request with neither header through, which is a program", () => {
    expect(allowed({})).toBe(true);
  });

  it("accepts the host the request arrived at, for a second hostname", () => {
    expect(
      allowed({ origin: "https://alt.example.test", host: "alt.example.test" }),
    ).toBe(true);
    expect(
      allowed({
        origin: "https://alt.example.test",
        host: "okr.example.test",
      }),
    ).toBe(false);
  });

  it("reads the forwarded host first behind a proxy", () => {
    expect(
      allowed({
        origin: "https://alt.example.test",
        "x-forwarded-host": "alt.example.test",
        host: "internal:3000",
      }),
    ).toBe(true);
  });

  it("refuses an unreadable origin", () => {
    expect(allowed({ origin: "not a url" })).toBe(false);
  });
});

describe("refuseCrossSite", () => {
  it("answers a plain 403 for a cross-site post", async () => {
    const refused = refuseCrossSite(
      new Request("http://localhost:3000/api/v1/admin/sso", {
        method: "POST",
        headers: { origin: "https://evil.example" },
      }),
    );
    expect(refused?.status).toBe(403);
    expect(await refused?.text()).toBe("Forbidden");
  });
});
