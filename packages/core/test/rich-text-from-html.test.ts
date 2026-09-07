import { describe, expect, it } from "vitest";
import {
  isValidRichText,
  RICH_TEXT_SCHEMA_VERSION,
  richTextFromHtml,
} from "../src/index.ts";

/**
 * The HTML converter (P6-T04b).
 *
 * Every case here is a shape a real FlowyTeam comment takes. The instance
 * this was written against holds 7223 of them, 6841 with markup, 503 with
 * anchors and 106 with an inline base64 image.
 */

const text = (doc: unknown): string => JSON.stringify(doc);

describe("richTextFromHtml", () => {
  it("keeps the text and loses the script", () => {
    const doc = richTextFromHtml(
      '<p>Hello <script>alert("x")</script>world</p>',
    );
    expect(doc).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Hello " },
            { type: "text", text: "world" },
          ],
        },
      ],
    });
    expect(text(doc)).not.toContain("alert");
  });

  it("does not leak a script body as text when it contains a bare <", () => {
    const doc = richTextFromHtml("<p>a</p><script>if (a < b) { x }</script>");
    expect(text(doc)).not.toContain("if (a");
  });

  it("refuses a javascript: href and keeps the words", () => {
    const doc = richTextFromHtml(
      '<p>see <a href="javascript:alert(1)">this</a></p>',
    );
    expect(text(doc)).not.toContain("javascript");
    expect(text(doc)).toContain("this");
  });

  it("keeps an http link as a mark", () => {
    const doc = richTextFromHtml(
      '<p>see <a href="https://example.com/a">this</a></p>',
    );
    expect(doc.content[1]).toBeUndefined();
    expect(JSON.stringify(doc.content[0])).toContain(
      '"href":"https://example.com/a"',
    );
  });

  it("strips every attribute the schema has no place for", () => {
    const doc = richTextFromHtml(
      '<p class="x" style="color:red" onclick="go()" data-id="7">hi</p>',
    );
    expect(doc).toEqual({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }],
    });
  });

  it("turns the mark tags into marks and merges nesting", () => {
    const doc = richTextFromHtml("<p><strong><em>both</em></strong></p>");
    expect(doc.content[0]).toEqual({
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "both",
          marks: [{ type: "bold" }, { type: "italic" }],
        },
      ],
    });
  });

  it("builds lists, headings and a rule", () => {
    const doc = richTextFromHtml(
      "<h2>Title</h2><ul><li>one</li><li>two</li></ul><hr>",
    );
    expect(doc.content.map((node) => node.type)).toEqual([
      "heading",
      "bulletList",
      "horizontalRule",
    ]);
    expect((doc.content[0] as { attrs: unknown }).attrs).toEqual({ level: 2 });
  });

  it("flattens a heading past the third level rather than dropping it", () => {
    const doc = richTextFromHtml("<h5>deep</h5>");
    expect(doc.content[0]).toEqual({
      type: "heading",
      attrs: { level: 3 },
      content: [{ type: "text", text: "deep" }],
    });
  });

  it("wraps loose text in a paragraph", () => {
    const doc = richTextFromHtml("bare words<br>and more");
    expect(doc.content[0]?.type).toBe("paragraph");
    expect(text(doc)).toContain("bare words");
    expect(text(doc)).toContain("and more");
  });

  it("keeps whitespace inside a code block and collapses it outside", () => {
    const doc = richTextFromHtml("<pre><code>a    b</code></pre><p>c    d</p>");
    expect(text(doc)).toContain("a    b");
    expect(text(doc)).toContain("c d");
  });

  it("decodes entities, named and numeric", () => {
    const doc = richTextFromHtml("<p>a &amp; b &#39;c&#39; &nbsp;d &#x41;</p>");
    expect(text(doc)).toContain("a & b 'c' d A");
  });

  it("survives unclosed and mismatched tags", () => {
    const doc = richTextFromHtml("<p><b>one<p>two</i></b>");
    expect(isValidRichText(doc, RICH_TEXT_SCHEMA_VERSION)).toBe(true);
    expect(text(doc)).toContain("one");
    expect(text(doc)).toContain("two");
  });

  it("drops an image when nothing can hold it, and reports it", () => {
    const dropped: string[] = [];
    const doc = richTextFromHtml(
      '<p>look <img src="data:image/png;base64,AA=="></p>',
      {
        onDropped: (what) => dropped.push(what),
      },
    );
    expect(dropped).toContain("an image");
    expect(text(doc)).toContain("look");
    expect(text(doc)).not.toContain("base64");
  });

  it("takes whatever node the caller makes of an image", () => {
    const doc = richTextFromHtml(
      '<p><img src="data:image/png;base64,AA==" alt="chart"></p>',
      {
        onImage: () => ({
          type: "attachment",
          attrs: {
            filename: "chart.png",
            contentType: "image/png",
            status: "ready",
            blobId: "11111111-1111-4111-8111-111111111111",
          },
        }),
      },
    );
    expect(text(doc)).toContain("chart.png");
    expect(isValidRichText(doc, RICH_TEXT_SCHEMA_VERSION)).toBe(true);
  });

  it("builds a table from rows and cells", () => {
    const doc = richTextFromHtml(
      "<table><tbody><tr><th>h</th><td>c</td></tr></tbody></table>",
    );
    expect(doc.content[0]?.type).toBe("table");
    expect(isValidRichText(doc, RICH_TEXT_SCHEMA_VERSION)).toBe(true);
    expect(text(doc)).toContain("tableHeader");
  });

  it("unwraps a span and keeps what is inside it", () => {
    const doc = richTextFromHtml('<p><span style="x">kept</span></p>');
    expect(text(doc)).toContain("kept");
    expect(text(doc)).not.toContain("span");
  });

  it("returns one empty paragraph for markup that said nothing", () => {
    expect(richTextFromHtml("<p>&nbsp;</p><div></div>")).toEqual({
      type: "doc",
      content: [{ type: "paragraph", content: [] }],
    });
  });

  it("drops an iframe whole", () => {
    const dropped: string[] = [];
    const doc = richTextFromHtml('<p>a</p><iframe src="https://x"></iframe>', {
      onDropped: (what) => dropped.push(what),
    });
    expect(dropped).toContain("<iframe>");
    expect(text(doc)).not.toContain("iframe");
  });

  /**
   * Five shapes from the 7223 comments on the instance this reads. Every one
   * threw before `normalise` was rewritten to consult `NESTING_RULES` rather
   * than a hand-written list of containers.
   */
  describe("nesting the schema forbids", () => {
    const cases: readonly (readonly [string, string, string])[] = [
      ["a list inside a list", "<ul><ul><li>deep</li></ul></ul>", "deep"],
      [
        "a table inside a table cell",
        "<table><tr><td><table><tr><td>inner</td></tr></table></td></tr></table>",
        "inner",
      ],
      [
        "a quoted email inside a quoted email",
        "<blockquote>outer<blockquote>inner</blockquote></blockquote>",
        "inner",
      ],
      ["a bare list item at the top", "<li>orphan</li>", "orphan"],
      [
        "a heading inside a table cell",
        "<table><tr><td><h1>head</h1></td></tr></table>",
        "head",
      ],
    ];
    for (const [name, html, kept] of cases) {
      it(`repairs ${name} and keeps the words`, () => {
        const doc = richTextFromHtml(html);
        expect(isValidRichText(doc, RICH_TEXT_SCHEMA_VERSION)).toBe(true);
        expect(text(doc)).toContain(kept);
      });
    }
  });

  it("strips marks inside a code block, which holds plain text only", () => {
    const doc = richTextFromHtml("<pre><b>bold</b> plain</pre>");
    expect(doc.content[0]).toEqual({
      type: "codeBlock",
      content: [{ type: "text", text: "bold plain" }],
    });
  });

  it("always produces a document the write boundary accepts", () => {
    const nasty = [
      "<p onmouseover=x>a</p>",
      "<<p>b</p>",
      "<p>c</p></div></div>",
      "<ul><p>stray</p></ul>",
      "<table><p>stray</p></table>",
      "<blockquote><h1>q</h1></blockquote>",
      "<p><ul><li>nested block in a paragraph</li></ul></p>",
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    ];
    for (const html of nasty) {
      expect(
        isValidRichText(richTextFromHtml(html), RICH_TEXT_SCHEMA_VERSION),
      ).toBe(true);
    }
  });
});
