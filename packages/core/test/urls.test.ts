import { describe, expect, it } from "vitest";
import { withoutTrailingSlashes } from "../src/urls.ts";

/**
 * The one trailing-slash trim (P5-T08a and P5-T08b, CodeQL `js/polynomial-redos`).
 *
 * The behaviour is small enough that the interesting part is the last test: a
 * string of nothing but slashes, which is what the anchored regular expression
 * this replaces would have spent quadratic time on.
 */
describe("withoutTrailingSlashes", () => {
  it("leaves a URL with no trailing slash alone", () => {
    expect(withoutTrailingSlashes("https://okr.example")).toBe(
      "https://okr.example",
    );
  });

  it("removes one", () => {
    expect(withoutTrailingSlashes("https://okr.example/")).toBe(
      "https://okr.example",
    );
  });

  it("removes several", () => {
    expect(withoutTrailingSlashes("https://okr.example///")).toBe(
      "https://okr.example",
    );
  });

  it("leaves an interior slash where it is", () => {
    expect(withoutTrailingSlashes("https://okr.example/api/mcp/")).toBe(
      "https://okr.example/api/mcp",
    );
  });

  it("returns empty for a string of slashes, and returns quickly", () => {
    const slashes = "/".repeat(50_000);
    const started = performance.now();
    expect(withoutTrailingSlashes(slashes)).toBe("");
    // Linear work on 50k characters is well under a millisecond. The anchored
    // `/\/+$/` replace this replaces is quadratic, and this input is the shape
    // that made CodeQL fail the build.
    expect(performance.now() - started).toBeLessThan(100);
  });

  it("handles the empty string", () => {
    expect(withoutTrailingSlashes("")).toBe("");
  });
});
