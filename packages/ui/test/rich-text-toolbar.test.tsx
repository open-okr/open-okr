import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, test } from "vitest";
import { CATALOGUES, translate } from "../src/i18n/catalogue.ts";
import { TranslationsProvider } from "../src/i18n/use-translations.tsx";
import { isBlankDocument } from "../src/rich-text/blank.ts";
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

describe("a rich text field in a form that writes every field", () => {
  test("sends the stored document unchanged, so a kept field is not an empty one", async () => {
    const { container } = inEnglish(
      <form>
        <RichTextField
          label="Stable"
          name="stable"
          content={PARAGRAPH}
          sendUnchanged
        />
        <RichTextField
          label="Declining"
          name="declining"
          content={null}
          sendUnchanged
        />
      </form>,
    );
    await editorReady(container);
    const stable = container.querySelector<HTMLInputElement>(
      'input[name="stable"]',
    );
    expect(JSON.parse(stable?.value ?? "null")).toEqual(PARAGRAPH);
    // Nothing stored is nothing sent, which the action reads as empty.
    expect(container.querySelector('input[name="declining"]')).toBeNull();
  });

  test("counts toward its limit", async () => {
    const { container } = inEnglish(
      <RichTextField
        label="Stable"
        name="stable"
        content={{
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "x".repeat(90) }],
            },
          ],
        }}
        maxCharacters={100}
      />,
    );
    await editorReady(container);
    expect(screen.getByText("90 of 100 characters")).not.toBeNull();
  });
});

describe("a blank document", () => {
  test("is one with nothing but empty paragraphs and spaces in it", () => {
    expect(isBlankDocument(null)).toBe(true);
    expect(
      isBlankDocument({ type: "doc", content: [{ type: "paragraph" }] }),
    ).toBe(true);
    expect(isBlankDocument(PARAGRAPH)).toBe(false);
    expect(
      isBlankDocument({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "   " }] },
        ],
      }),
    ).toBe(true);
    expect(
      isBlankDocument({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "mention", attrs: { id: "m", label: "Priya" } }],
          },
        ],
      }),
    ).toBe(false);
  });
});

describe("a length limit", () => {
  const words = (count: number) => ({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "x".repeat(count) }],
      },
    ],
  });

  test("says nothing while the text is well inside it", async () => {
    const { container } = inEnglish(
      <RichTextEditor
        label="What it changes"
        variant="compact"
        content={words(10)}
        maxCharacters={100}
      />,
    );
    await editorReady(container);
    expect(screen.queryByText(/of 100 characters/)).toBeNull();
  });

  test("counts once the text is near it, the way the server counts", async () => {
    const { container } = inEnglish(
      <RichTextEditor
        label="What it changes"
        variant="compact"
        content={words(85)}
        maxCharacters={100}
      />,
    );
    await editorReady(container);
    expect(screen.getByText("85 of 100 characters")).not.toBeNull();
  });

  test("says how much to take out once it is over", async () => {
    const { container } = inEnglish(
      <RichTextEditor
        label="What it changes"
        variant="compact"
        content={words(104)}
        maxCharacters={100}
      />,
    );
    await editorReady(container);
    expect(
      screen.getByText(
        translate(CATALOGUES.en, "fields.counterOver", {
          used: 104,
          max: 100,
          over: 4,
        }),
      ),
    ).not.toBeNull();
  });
});

describe("an editor that is not editable", () => {
  test("follows the prop after it was made", async () => {
    const { container, rerender } = inEnglish(
      <RichTextEditor
        label="What it changes"
        variant="compact"
        content={PARAGRAPH}
      />,
    );
    await editorReady(container);
    rerender(
      <TranslationsProvider locale="en">
        <RichTextEditor
          label="What it changes"
          variant="compact"
          content={PARAGRAPH}
          editable={false}
        />
      </TranslationsProvider>,
    );
    await waitFor(() =>
      expect(container.querySelector('[contenteditable="false"]')).toBeTruthy(),
    );
    expect(screen.queryByRole("toolbar")).toBeNull();
  });
});
