import { OperationError, trustedEmailDomainsSchema } from "@openokr/core";
import { describe, expect, it } from "vitest";
import {
  refusalFields,
  refusalOf,
  refusedByField,
  refusedSentence,
  refusedState,
} from "../lib/refusal.ts";

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

describe("what a form wrapped in RefusedFields gets back (plan U1b)", () => {
  it("hands every named field down, and no sentence, since the provider says any no field claims", () => {
    expect(
      refusedByField(
        zodError([
          {
            code: "too_big",
            origin: "string",
            maximum: 80,
            path: ["name"],
            message: "Too big: expected string to have <=80 characters",
          },
        ]),
        t,
      ),
    ).toEqual({ error: null, fields: { name: 'fields.tooLong:{"max":80}' } });
  });

  it("keeps the sentence for a refusal about the whole save", () => {
    expect(
      refusedByField(
        new OperationError(
          "forbidden",
          "This space still holds an open cycle.",
        ),
        t,
      ),
    ).toEqual({ error: "This space still holds an open cycle." });
  });

  it("is nothing for a failure", () => {
    expect(refusedByField(new Error("gone"), t)).toBe(null);
  });
});

describe("a refusal for a control with no field (plan U1b)", () => {
  it("is the sentence, a schema's in the catalogue's words", () => {
    expect(
      refusedSentence(
        zodError([
          {
            code: "too_big",
            origin: "number",
            maximum: 100,
            path: ["actualValue"],
            message: "Too big: expected number to be <=100",
          },
        ]),
        t,
      ),
    ).toEqual({ error: 'fields.atMost:{"max":100}' });
    expect(
      refusedSentence(new OperationError("forbidden", "Closed."), t),
    ).toEqual({ error: "Closed." });
    expect(refusedSentence(new Error("gone"), t)).toBe(null);
  });
});

describe("a refused path the form names differently (plan U1b)", () => {
  const renamed = {
    retrospectiveBody: "retrospective",
    "values.0.value": "value",
  };

  it("lands on the field the person typed it in, for a schema and an operation alike", () => {
    expect(
      refusedByField(
        zodError([
          {
            code: "custom",
            path: ["values", 0, "value"],
            message: "Not a number.",
          },
        ]),
        t,
        renamed,
      ),
    ).toEqual({ error: null, fields: { value: "Not a number." } });
    expect(
      refusedByField(
        new OperationError(
          "forbidden",
          "Say what happened.",
          undefined,
          "retrospectiveBody",
        ),
        t,
        renamed,
      ),
    ).toEqual({ error: null, fields: { retrospective: "Say what happened." } });
  });

  it("counts as drawn under its form name, so the sentence is not said twice", () => {
    expect(
      refusedState(
        new OperationError(
          "forbidden",
          "Not a number.",
          undefined,
          "values.0.value",
        ),
        t,
        ["value"],
        renamed,
      ),
    ).toEqual({ fields: { value: "Not a number." } });
  });

  it("leaves a path with no other name as it is", () => {
    expect(
      refusalFields(
        new OperationError("forbidden", "Too long.", undefined, "title"),
        t,
        renamed,
      ),
    ).toEqual({ message: "Too long.", fields: { title: "Too long." } });
  });
});
