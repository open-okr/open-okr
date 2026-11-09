import { OperationError, trustedEmailDomainsSchema } from "@openokr/core";
import { describe, expect, it } from "vitest";
import { refusalFields, refusalOf, refusedState } from "../lib/refusal.ts";

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

/** A schema refusal by shape, as the helper reads one from another zod copy. */
const zodError = (issues: readonly Record<string, unknown>[]) =>
  Object.assign(new Error(JSON.stringify(issues)), {
    name: "ZodError",
    issues,
  });

/** A translator that shows which key and values it was asked for. */
const t = (key: string, values?: Readonly<Record<string, string | number>>) =>
  values ? `${key}:${JSON.stringify(values)}` : key;

describe("a refusal by field (guided-inputs §4.2, plan U1)", () => {
  it("names every field a schema refused, the first message for each", () => {
    const refusal = refusalFields(
      zodError([
        {
          code: "custom",
          path: ["reason"],
          message: "A change needs a reason.",
        },
        { code: "custom", path: ["reason"], message: "A second complaint." },
        {
          code: "custom",
          path: ["keyResults", 0, "title"],
          message: "Name it.",
        },
      ]),
    );
    expect(refusal).toEqual({
      message: "A change needs a reason.",
      fields: {
        reason: "A change needs a reason.",
        "keyResults.0.title": "Name it.",
      },
    });
  });

  it("says zod's own wording in the catalogue's, and keeps a sentence a schema wrote", () => {
    const refusal = refusalFields(
      zodError([
        {
          code: "too_big",
          origin: "string",
          maximum: 500,
          path: ["reason"],
          message: "Too big: expected string to have <=500 characters",
        },
        {
          code: "too_small",
          origin: "string",
          minimum: 1,
          path: ["name"],
          message: "Too small: expected string to have >=1 characters",
        },
        {
          code: "too_big",
          origin: "number",
          maximum: 10,
          path: ["seats"],
          message: "Too big: expected number to be <=10",
        },
        {
          code: "too_small",
          origin: "string",
          minimum: 1,
          path: ["title"],
          message: "Give it a title.",
        },
      ]),
      t,
    );
    expect(refusal?.fields).toEqual({
      reason: 'fields.tooLong:{"max":500}',
      name: "fields.required",
      seats: 'fields.atMost:{"max":10}',
      title: "Give it a title.",
    });
  });

  it("names the one field an operation refusal is about", () => {
    expect(
      refusalFields(
        new OperationError(
          "conflict",
          "That title is taken.",
          undefined,
          "title",
        ),
      ),
    ).toEqual({
      message: "That title is taken.",
      fields: { title: "That title is taken." },
    });
    expect(
      refusalFields(new OperationError("forbidden", "12 seats are in use.")),
    ).toEqual({ message: "12 seats are in use.", fields: {} });
  });

  it("is nothing for a failure", () => {
    expect(refusalFields(new Error("connect ECONNREFUSED"))).toBe(null);
  });
});

describe("what a form gets back", () => {
  it("puts a message under the field it draws, and says it once", () => {
    expect(
      refusedState(
        new OperationError(
          "conflict",
          "That title is taken.",
          undefined,
          "title",
        ),
        t,
        ["title", "reason"],
      ),
    ).toEqual({ fields: { title: "That title is taken." } });
  });

  it("says the sentence above the form when no field it draws took it", () => {
    expect(
      refusedState(
        new OperationError(
          "conflict",
          "That title is taken.",
          undefined,
          "title",
        ),
        t,
        ["reason"],
      ),
    ).toEqual({ error: "That title is taken." });
    expect(
      refusedState(new OperationError("forbidden", "12 seats are in use."), t, [
        "reason",
      ]),
    ).toEqual({ error: "12 seats are in use." });
  });

  it("throws nothing away for a failure: the caller throws it on", () => {
    expect(refusedState(new Error("gone"), t, ["reason"])).toBe(null);
  });
});
