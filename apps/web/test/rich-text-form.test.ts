import { describe, expect, it } from "vitest";
import { documentOrNull, readRichTextField } from "../lib/rich-text-form.ts";

/**
 * Reading a rich text field a form posted (docs/design/guided-inputs.md §4.7).
 *
 * `RichTextField` sends nothing until it is edited, an editor emptied by hand
 * sends one empty paragraph, and anything else is the document. An action
 * needs to tell the four apart: "leave it", "it is required", "it is
 * broken", and the text itself.
 */

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    data.set(name, value);
  }
  return data;
}

const PARAGRAPH = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "Shipped", marks: [{ type: "bold" }] }],
    },
  ],
};

describe("a rich text field from a form", () => {
  it("is absent when the field was never edited", () => {
    expect(readRichTextField(form({}), "narrative")).toEqual({
      state: "absent",
    });
  });

  it("is blank when it holds only an empty paragraph", () => {
    const empty = JSON.stringify({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
    expect(readRichTextField(form({ narrative: empty }), "narrative")).toEqual({
      state: "blank",
    });
  });

  it("is blank when it holds only spaces", () => {
    const spaces = JSON.stringify({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "   " }] },
      ],
    });
    expect(readRichTextField(form({ narrative: spaces }), "narrative")).toEqual(
      { state: "blank" },
    );
  });

  it("is the document, formatting and all, when something was written", () => {
    const read = readRichTextField(
      form({ narrative: JSON.stringify(PARAGRAPH) }),
      "narrative",
    );
    expect(read).toEqual({ state: "document", document: PARAGRAPH });
  });

  it.each([
    ["text that is not JSON", "Shipped"],
    ["JSON that is not a document", JSON.stringify({ type: "script" })],
  ])("is malformed for %s", (_, value) => {
    expect(readRichTextField(form({ narrative: value }), "narrative")).toEqual({
      state: "malformed",
    });
  });
});

describe("a field from a form that writes every field on each save", () => {
  it("is the document, null when empty or not sent, and says when it is broken", () => {
    const empty = JSON.stringify({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
    expect(
      documentOrNull(form({ stable: JSON.stringify(PARAGRAPH) }), "stable"),
    ).toEqual(PARAGRAPH);
    expect(documentOrNull(form({ stable: empty }), "stable")).toBeNull();
    // Nothing stored and nothing typed sends nothing, which is empty too.
    expect(documentOrNull(form({}), "stable")).toBeNull();
    expect(documentOrNull(form({ stable: "Churn" }), "stable")).toBe(
      "malformed",
    );
  });
});
