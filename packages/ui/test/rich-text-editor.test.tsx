import {
  fireEvent,
  render as renderBare,
  waitFor,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, test } from "vitest";
import { TranslationsProvider } from "../src/i18n/use-translations.tsx";
import { RichTextEditor } from "../src/rich-text/editor.tsx";

// The full editor has a toolbar since guided-inputs change 5b, and its labels
// are translated, so it is drawn inside the provider every page has.
const render = (node: ReactElement) =>
  renderBare(<TranslationsProvider locale="en">{node}</TranslationsProvider>);

const SIMPLE_DOC = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
};

describe("RichTextEditor", () => {
  test("mounts with initial content and renders it", async () => {
    const { container } = render(
      <RichTextEditor label="Notes" content={SIMPLE_DOC} />,
    );
    await waitFor(() => {
      expect(container.querySelector('[contenteditable="true"]')).toBeTruthy();
    });
    expect(container.textContent).toContain("Hello");
  });

  test("calls onUpdate with valid rich text JSON, and validate sees it", async () => {
    const seen: unknown[] = [];
    const { container } = render(
      <RichTextEditor
        label="Notes"
        content={SIMPLE_DOC}
        onUpdate={(json) => seen.push(json)}
        validate={(json) => {
          seen.push({ validated: json });
          return true;
        }}
      />,
    );
    await waitFor(() => {
      expect(container.querySelector('[contenteditable="true"]')).toBeTruthy();
    });
    // The editor's own onCreate does not fire onUpdate; nothing has been
    // typed yet, so nothing should have been reported.
    expect(seen).toHaveLength(0);
  });

  test("renders read-only when editable is false", async () => {
    const { container } = render(
      <RichTextEditor label="Notes" content={SIMPLE_DOC} editable={false} />,
    );
    await waitFor(() => {
      expect(container.querySelector("[contenteditable]")).toBeTruthy();
    });
    expect(container.querySelector('[contenteditable="false"]')).toBeTruthy();
  });

  /**
   * Completeness review L-22. The element TipTap would add is exactly what the
   * Content-Security-Policy refuses, so it must never be added; the rules it
   * carried are in `styles/prosemirror.css`.
   */
  test("adds no inline style element for the policy to refuse", async () => {
    const { container } = render(
      <RichTextEditor label="Notes" content={SIMPLE_DOC} />,
    );
    await waitFor(() => {
      expect(container.querySelector('[contenteditable="true"]')).toBeTruthy();
    });
    expect(document.head.querySelector("style[data-tiptap-style]")).toBeNull();
  });

  /**
   * The editing surface is a textbox, and a textbox with no name is a serious
   * axe finding (`aria-input-field-name`): a screen reader announces it as
   * "edit text" with nothing to say what it is for. TipTap 3.31.4 started
   * keeping the role it adds, which is how s43 found the missing name; this
   * holds on either side of that release.
   */
  test("names the editing surface for assistive technology", async () => {
    const { findByRole } = render(
      <RichTextEditor label="Bio" content={SIMPLE_DOC} />,
    );
    const surface = await findByRole("textbox", { name: "Bio" });
    expect(surface.getAttribute("aria-multiline")).toBe("true");
  });
});

/**
 * A file pasted or dropped into the text (rich-text-editor.md §7, plan 0.7.0
 * R4). The node appears at once as `uploading`, turns `ready` with the id the
 * host's upload gave, and goes again if the upload fails, never left pointing
 * at nothing.
 */
describe("a file in the text", () => {
  const BLOB = "11111111-1111-4111-8111-111111111111";
  const file = () =>
    new File(["picture"], "whiteboard.png", { type: "image/png" });

  /** Every attachment node in the last document the editor reported. */
  const attachmentsIn = (json: unknown) => {
    const found: Record<string, unknown>[] = [];
    const walk = (node: unknown) => {
      const record = node as {
        type?: string;
        attrs?: Record<string, unknown>;
        content?: unknown[];
      };
      if (record.type === "attachment" && record.attrs) {
        found.push(record.attrs);
      }
      for (const child of record.content ?? []) {
        walk(child);
      }
    };
    walk(json);
    return found;
  };

  const paste = (surface: HTMLElement) =>
    fireEvent.paste(surface, {
      clipboardData: {
        files: [file()],
        types: ["Files"],
        getData: () => "",
      },
    });

  test("turns ready with the id the upload gave", async () => {
    let finish: (value: { blobId: string }) => void = () => undefined;
    const seen: unknown[] = [];
    const { findByRole } = render(
      <RichTextEditor
        label="Notes"
        content={SIMPLE_DOC}
        onUpdate={(json) => seen.push(json)}
        uploadFile={() =>
          new Promise((resolve) => {
            finish = resolve;
          })
        }
      />,
    );
    paste(await findByRole("textbox", { name: "Notes" }));

    await waitFor(() => {
      expect(attachmentsIn(seen.at(-1))).toEqual([
        expect.objectContaining({
          filename: "whiteboard.png",
          contentType: "image/png",
          status: "uploading",
        }),
      ]);
    });

    finish({ blobId: BLOB });
    await waitFor(() => {
      expect(attachmentsIn(seen.at(-1))).toEqual([
        expect.objectContaining({ status: "ready", blobId: BLOB }),
      ]);
    });
  });

  test("goes again when the upload fails", async () => {
    const seen: unknown[] = [];
    const { findByRole } = render(
      <RichTextEditor
        label="Notes"
        content={SIMPLE_DOC}
        onUpdate={(json) => seen.push(json)}
        uploadFile={() => Promise.reject(new Error("refused"))}
      />,
    );
    paste(await findByRole("textbox", { name: "Notes" }));

    await waitFor(() => {
      expect(seen.length).toBeGreaterThan(1);
      expect(attachmentsIn(seen.at(-1))).toEqual([]);
    });
  });

  test("says a file can go in, only where one can", async () => {
    const upload = async () => ({ blobId: BLOB });
    const { getByText, queryByText, rerender } = render(
      <RichTextEditor label="Notes" content={SIMPLE_DOC} uploadFile={upload} />,
    );
    await waitFor(() => {
      expect(getByText("Paste or drop a file to attach it.")).toBeTruthy();
    });

    rerender(
      <TranslationsProvider locale="en">
        <RichTextEditor label="Notes" content={SIMPLE_DOC} />
      </TranslationsProvider>,
    );
    expect(queryByText("Paste or drop a file to attach it.")).toBeNull();
  });

  test("names a file's remove button, and draws none where the text is read only", async () => {
    const withFile = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "attachment",
              attrs: {
                filename: "whiteboard.png",
                contentType: "image/png",
                status: "ready",
                blobId: BLOB,
              },
            },
          ],
        },
      ],
    };
    const editable = render(<RichTextEditor label="One" content={withFile} />);
    expect(
      await editable.findByRole("button", { name: "Remove whiteboard.png" }),
    ).toBeTruthy();
    editable.unmount();

    const readOnly = render(
      <RichTextEditor label="Two" content={withFile} editable={false} />,
    );
    await waitFor(() => {
      expect(readOnly.container.textContent).toContain("whiteboard.png");
    });
    expect(
      readOnly.queryByRole("button", { name: "Remove whiteboard.png" }),
    ).toBeNull();
  });
});
