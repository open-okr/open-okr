import { TranslationsProvider } from "@openokr/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { DocumentEditor } from "../app/documents/document-editor.tsx";
import { FILE_LINKS, richTextHtml } from "../lib/rich-text-html.ts";

/**
 * A file in a comment's or a document's text is a link to the download route,
 * which decides who may open it (docs/design/rich-text-editor.md §11 D14).
 * The write recorded the row that lets a reader through; without the link the
 * row would change nothing a person sees.
 */

const BLOB = "11111111-1111-4111-8111-111111111111";

const withFile = (status: "ready" | "uploading") => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "The whiteboard " },
        {
          type: "attachment",
          attrs: {
            filename: "whiteboard.png",
            contentType: "image/png",
            status,
            ...(status === "ready" ? { blobId: BLOB } : {}),
          },
        },
      ],
    },
  ],
});

describe("a file in the text", () => {
  test("links to the download route where the text records its files", () => {
    const html = richTextHtml(withFile("ready"), FILE_LINKS);
    expect(html).toContain(
      `<a class="attachment" href="/api/blobs/${BLOB}">whiteboard.png</a>`,
    );
  });

  test("stays a filename everywhere else", () => {
    const html = richTextHtml(withFile("ready"));
    expect(html).toContain('<span class="attachment">whiteboard.png</span>');
    expect(html).not.toContain("/api/blobs/");
  });

  test("is never a link while it is still uploading", () => {
    const html = richTextHtml(withFile("uploading"), FILE_LINKS);
    expect(html).not.toContain("<a");
  });
});

describe("a document a reader cannot edit", () => {
  const noWrite = async () => ({ error: null });
  const render = (html: string | null) =>
    renderToStaticMarkup(
      <TranslationsProvider locale="en">
        <DocumentEditor
          title="Plan"
          body={withFile("ready")}
          html={html}
          state="published"
          canEdit={false}
          onSave={noWrite}
          onPublish={noWrite}
        />
      </TranslationsProvider>,
    );

  test("is the rendered text, where its file opens", () => {
    const markup = render(richTextHtml(withFile("ready"), FILE_LINKS));
    expect(markup).toContain(`href="/api/blobs/${BLOB}"`);
    expect(markup).not.toContain("contenteditable");
  });

  test("says when nothing is written", () => {
    expect(render(null)).toContain("Nothing written yet.");
  });
});
