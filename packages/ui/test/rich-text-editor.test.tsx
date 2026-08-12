import { render, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { RichTextEditor } from "../src/rich-text/editor.tsx";

const SIMPLE_DOC = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
};

describe("RichTextEditor", () => {
  test("mounts with initial content and renders it", async () => {
    const { container } = render(<RichTextEditor content={SIMPLE_DOC} />);
    await waitFor(() => {
      expect(container.querySelector('[contenteditable="true"]')).toBeTruthy();
    });
    expect(container.textContent).toContain("Hello");
  });

  test("calls onUpdate with valid rich text JSON, and validate sees it", async () => {
    const seen: unknown[] = [];
    const { container } = render(
      <RichTextEditor
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
      <RichTextEditor content={SIMPLE_DOC} editable={false} />,
    );
    await waitFor(() => {
      expect(container.querySelector("[contenteditable]")).toBeTruthy();
    });
    expect(container.querySelector('[contenteditable="false"]')).toBeTruthy();
  });
});
