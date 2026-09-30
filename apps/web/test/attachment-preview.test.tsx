import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TranslationsProvider } from "@openokr/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { AttachmentPreview, fileKind } from "../lib/attachment-preview.tsx";
import { type AttachmentRow, Attachments } from "../lib/attachments.tsx";

/**
 * The attachment list shows a picture or an icon beside every file, and no
 * link to a file that is not ready (completeness review M-24).
 *
 * Rendered for real, on the server renderer, rather than read as source: what
 * matters is the markup a member receives, and in particular that a file the
 * virus scan is holding has no link to click. The upload and detach actions
 * are replaced, because the panel only needs to render and they reach the
 * database.
 */

vi.mock("../lib/attachment-actions.ts", () => ({
  uploadAttachment: vi.fn(),
  detachAttachment: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined }),
}));

const BLOB = "11111111-1111-4111-8111-111111111111";

const row = (overrides: Partial<AttachmentRow>): AttachmentRow => ({
  id: "22222222-2222-4222-8222-222222222222",
  blobId: BLOB,
  filename: "whiteboard.png",
  contentType: "image/png",
  filesize: 2048,
  status: "ok",
  hasThumbnail: true,
  ...overrides,
});

const panel = (attachments: readonly AttachmentRow[], canEdit = false) =>
  renderToStaticMarkup(
    <TranslationsProvider locale="en">
      <Attachments
        subjectType="document"
        subjectId="33333333-3333-4333-8333-333333333333"
        attachments={attachments}
        canEdit={canEdit}
      />
    </TranslationsProvider>,
  );

describe("the preview square", () => {
  test("pulses until the thumbnail has loaded, and is hidden from a screen reader", () => {
    // The picture itself is drawn only once it has loaded, which a server
    // render never sees: what a member receives first is the pulsing square.
    const html = renderToStaticMarkup(
      <AttachmentPreview blobId={BLOB} kind="image" showThumbnail />,
    );
    expect(html).toContain('data-testid="attachment-thumbnail"');
    expect(html).toContain('data-state="loading"');
    expect(html).toContain("motion-safe:animate-pulse");
    // The file name beside it says what it is; the picture repeats nothing.
    expect(html).toContain('aria-hidden="true"');
  });

  test("asks the route that checks access, not the storage", () => {
    // Read from the source because the server render stops before the image
    // is requested. The end-to-end spec in s29-documents loads it for real.
    const source = readFileSync(
      fileURLToPath(new URL("../lib/attachment-preview.tsx", import.meta.url)),
      "utf8",
    );
    expect(source).toMatch(/src=\{`\/api\/blobs\/\$\{blobId\}\/thumbnail`\}/);
    expect(source).toContain('alt=""');
  });

  test("shows the type's icon, and asks for nothing, when there is no thumbnail", () => {
    const html = renderToStaticMarkup(
      <AttachmentPreview blobId={BLOB} kind="pdf" showThumbnail={false} />,
    );
    expect(html).toContain('data-testid="attachment-icon"');
    expect(html).toContain('data-kind="pdf"');
    expect(html).not.toContain("attachment-thumbnail");
  });

  test("names a kind for every type the upload allow-list accepts", () => {
    expect(fileKind("image/webp")).toBe("image");
    expect(fileKind("application/pdf")).toBe("pdf");
    expect(fileKind("text/csv")).toBe("spreadsheet");
    expect(
      fileKind(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ),
    ).toBe("spreadsheet");
    expect(fileKind("application/vnd.ms-excel")).toBe("spreadsheet");
    expect(
      fileKind(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe("document");
    expect(fileKind("application/msword")).toBe("document");
    expect(fileKind("text/plain")).toBe("text");
    expect(fileKind("application/octet-stream")).toBe("file");
  });
});

describe("the attachment list", () => {
  test("an image that is ready shows its thumbnail and links to the file", () => {
    const html = panel([row({})]);
    expect(html).toContain('data-testid="attachment-thumbnail"');
    expect(html).toContain(`href="/api/blobs/${BLOB}"`);
    expect(html).toContain("Image · 2 KB");
  });

  test("a file with no thumbnail shows the icon for its type", () => {
    const html = panel([
      row({
        filename: "brief.pdf",
        contentType: "application/pdf",
        hasThumbnail: false,
      }),
    ]);
    expect(html).toContain('data-kind="pdf"');
    expect(html).toContain("PDF document");
    expect(html).not.toContain("attachment-thumbnail");
  });

  test("a file the virus scan is checking has no link and says why", () => {
    const html = panel([row({ status: "scanning" })]);
    expect(html).not.toContain(`href="/api/blobs/${BLOB}"`);
    // Not even the preview: nothing about a held file is served.
    expect(html).not.toContain("attachment-thumbnail");
    expect(html).toContain('data-kind="image"');
    expect(html).toContain("Being checked");
    expect(html).toContain("A virus scan runs before anyone can open it.");
  });

  test("a file the scan held back has no link and says so", () => {
    const html = panel([row({ status: "quarantined" })]);
    expect(html).not.toContain(`href="/api/blobs/${BLOB}"`);
    expect(html).toContain("Held back");
    expect(html).toContain("The virus scan held this file back");
  });

  test("an empty list says there is nothing attached", () => {
    expect(panel([])).toContain("Nothing attached.");
  });

  test("the attach button is there for a member who can edit", () => {
    expect(panel([], true)).toContain('data-testid="attachment-upload"');
    expect(panel([], false)).not.toContain('data-testid="attachment-upload"');
  });
});
