import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, test } from "vitest";
import { CATALOGUES, translate } from "../src/i18n/catalogue.ts";
import { TranslationsProvider } from "../src/i18n/use-translations.tsx";
import { RichTextEditor } from "../src/rich-text/editor.tsx";
import { RichTextField } from "../src/rich-text/rich-text-field.tsx";

/**
 * The compact editor (docs/design/guided-inputs.md §4.7): simple formatting
 * from a toolbar, for the prose people write for each other in a comment, a
 * narrative or a bio.
 */

const en = (key: string) => translate(CATALOGUES.en, key);

function inEnglish(children: ReactNode) {
  return render(
    <TranslationsProvider locale="en">{children}</TranslationsProvider>,
  );
}

const PARAGRAPH = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
};

const editorReady = (container: HTMLElement) =>
  waitFor(() =>
    expect(container.querySelector('[contenteditable="true"]')).toBeTruthy(),
  );

describe("the compact editor's toolbar", () => {
  test("offers the simple formats, in one toolbar with one tab stop", async () => {
    const { container } = inEnglish(
      <RichTextEditor label="Comment" variant="compact" content={PARAGRAPH} />,
    );
    await editorReady(container);

    const toolbar = screen.getByRole("toolbar", {
      name: en("editor.toolbar.label"),
    });
    const names = [...toolbar.querySelectorAll("button")].map((button) =>
      button.getAttribute("aria-label"),
    );
    expect(names).toEqual([
      en("editor.toolbar.bold"),
      en("editor.toolbar.italic"),
      en("editor.toolbar.strike"),
      en("editor.toolbar.code"),
      en("editor.toolbar.bulletList"),
      en("editor.toolbar.orderedList"),
      en("editor.toolbar.link"),
    ]);
    // Underline is read, not written, until the release after this one.
    expect(names).not.toContain("Underline");
    const reachable = [...toolbar.querySelectorAll("button")].filter(
      (button) => button.getAttribute("tabindex") !== "-1",
    );
    expect(reachable).toHaveLength(1);
  });

  test("says whether a format is on, and turns it on", async () => {
    const user = userEvent.setup();
    const { container } = inEnglish(
      <RichTextEditor label="Comment" variant="compact" content={PARAGRAPH} />,
    );
    await editorReady(container);
    const bold = screen.getByRole("button", {
      name: en("editor.toolbar.bold"),
    });

    expect(bold.getAttribute("aria-pressed")).toBe("false");
    await user.click(bold);
    await waitFor(() => expect(bold.getAttribute("aria-pressed")).toBe("true"));
  });

  test("asks for a link's address, and refuses one that is not a web or mail link", async () => {
    const user = userEvent.setup();
    const { container } = inEnglish(
      <RichTextEditor label="Comment" variant="compact" content={PARAGRAPH} />,
    );
    await editorReady(container);

    await user.click(
      screen.getByRole("button", { name: en("editor.toolbar.link") }),
    );
    const address = screen.getByLabelText(en("editor.link.address"));
    await user.type(address, "javascript:alert(1)");
    await user.tab();
    expect(await screen.findByText(en("editor.link.invalid"))).not.toBeNull();
  });

  test("has no toolbar in the full editor yet", async () => {
    const { container } = inEnglish(
      <RichTextEditor label="Document" content={PARAGRAPH} />,
    );
    await editorReady(container);
    expect(screen.queryByRole("toolbar")).toBeNull();
  });
});

describe("underline, which this release reads and does not write", () => {
  test("shows a document that carries it", async () => {
    const underlined = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Mind " },
            { type: "text", text: "this", marks: [{ type: "underline" }] },
          ],
        },
      ],
    };
    const { container } = inEnglish(
      <RichTextEditor label="Comment" variant="compact" content={underlined} />,
    );
    await editorReady(container);
    expect(container.querySelector("u")?.textContent).toBe("this");
  });
});

describe("a rich text field in a form", () => {
  test("is labelled, and submits nothing until it is edited", async () => {
    const { container } = inEnglish(
      <form>
        <RichTextField
          label="Bio"
          name="bio"
          content={PARAGRAPH}
          description="A few lines about you."
        />
      </form>,
    );
    await editorReady(container);

    expect(screen.getByText("Bio").tagName).toBe("LEGEND");
    expect(screen.getByRole("textbox", { name: "Bio" })).not.toBeNull();
    // An untouched field is not sent, so saving the form does not write a new
    // version of something nobody changed.
    expect(container.querySelector('input[name="bio"]')).toBeNull();
  });
});
