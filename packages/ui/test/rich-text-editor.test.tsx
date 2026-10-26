import { render as renderBare, waitFor } from "@testing-library/react";
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
