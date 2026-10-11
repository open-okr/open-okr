import { OperationError, trustedEmailDomainsSchema } from "@openokr/core";
import { describe, expect, it } from "vitest";
import { refusalOf } from "../lib/refusal.ts";

/**
 * What a form says when a save is refused (guided-inputs §5, F5).
 *
 * Five forms caught a refusal and said nothing, or showed zod's error as the
 * JSON it serialises to. A refusal is a sentence the domain already wrote;
 * anything else is a failure, which the error page is for.
 */
describe("a refusal", () => {
  it("is the sentence an operation refused with", () => {
    expect(
      refusalOf(new OperationError("forbidden", "12 seats are in use.")),
    ).toBe("12 seats are in use.");
  });

  it("is the first sentence a schema refused with, not the JSON of every issue", () => {
    // A schema core exports, so the error is the one a domain door throws.
    const parsed = trustedEmailDomainsSchema.safeParse(["one", "two"]);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toHaveLength(2);
      expect(parsed.error.message).toContain("[");
      expect(refusalOf(parsed.error)).toBe("not a domain");
    }
  });

  it("is nothing for a failure, which is left to the error page", () => {
    expect(refusalOf(new Error("connect ECONNREFUSED 127.0.0.1:5432"))).toBe(
      null,
    );
    expect(refusalOf("not even an error")).toBe(null);
  });
});
