import { describe, expect, it } from "vitest";
import {
  richTextAsLine,
  richTextLength,
  textOfRichTextNode,
} from "../src/index.ts";

/**
 * How much a rich text document says (docs/design/guided-inputs.md §4.7).
 *
 * The editor's counter and the server's limit count with this, so a field
 * that says "980 of 1000" is never refused for being over 1000. The text is
 * what a reader sees: formatting adds nothing, and a mention counts as its
 * name.
 */

const paragraph = (...content: unknown[]) => ({ type: "paragraph", content });
const text = (value: string, marks?: unknown[]) => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});

describe("the text of a document", () => {
  it("reads every block as one line, a space between them", () => {
    const document = {
      type: "doc",
      content: [
        paragraph(text("Shipped "), text("on time", [{ type: "bold" }])),
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [paragraph(text("Ask for access"))] },
          ],
        },
      ],
    };
    expect(richTextAsLine(document)).toBe("Shipped on time Ask for access");
  });

  it("collapses runs of whitespace and trims the ends", () => {
    const document = {
      type: "doc",
      content: [paragraph(text("  two   spaces  ")), paragraph()],
    };
    expect(richTextAsLine(document)).toBe("two spaces");
  });

  it("names a mention, a link to something and an attachment", () => {
    const document = {
      type: "doc",
      content: [
        paragraph(
          { type: "mention", attrs: { id: "m-1", label: "Priya" } },
          text(" see "),
          { type: "entityLink", attrs: { label: "Activation" } },
          text(" "),
          { type: "attachment", attrs: { filename: "plan.pdf" } },
        ),
      ],
    };
    expect(richTextAsLine(document)).toBe("@Priya see Activation plan.pdf");
    expect(
      richTextAsLine(document, (id) => (id === "m-1" ? "Priya N." : undefined)),
    ).toBe("@Priya N. see Activation plan.pdf");
  });

  it("gives a line break and a rule no text of their own", () => {
    expect(
      textOfRichTextNode(
        paragraph(text("a"), { type: "hardBreak" }, text("b")),
      ),
    ).toBe("ab");
  });

  it("reads nothing from what is not a document", () => {
    expect(richTextAsLine(null)).toBe("");
    expect(richTextAsLine("text")).toBe("");
    expect(richTextAsLine({ type: "doc" })).toBe("");
  });
});

describe("the length of a document", () => {
  it("counts the characters a reader sees, not the formatting", () => {
    const plain = { type: "doc", content: [paragraph(text("Shipped"))] };
    const bold = {
      type: "doc",
      content: [paragraph(text("Shipped", [{ type: "bold" }]))],
    };
    expect(richTextLength(plain)).toBe(7);
    expect(richTextLength(bold)).toBe(7);
  });

  it("counts an empty editor as nothing", () => {
    expect(richTextLength({ type: "doc", content: [paragraph()] })).toBe(0);
  });
});
