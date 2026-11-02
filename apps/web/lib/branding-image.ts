/**
 * A workspace's logo and favicon, for the browser and the shell
 * (docs/design/workspace-logo-favicon.md).
 */

/**
 * Why a chosen file cannot be a logo or favicon, or null.
 *
 * Asked in the browser the moment a file is chosen, so the preview never shows
 * a picture the server would refuse. The server action asks again, and its
 * answer is the one that counts.
 *
 * **The limits arrive as an argument.** They live in `packages/core`, which a
 * client component may import types from and nothing else, so the server page
 * hands them to the card.
 */
export interface BrandingImageRules {
  readonly types: readonly string[];
  readonly maxBytes: number;
}

export function brandingImageProblem(
  file: { readonly type: string; readonly size: number },
  rules: BrandingImageRules,
): "type" | "size" | "empty" | null {
  if (!rules.types.includes(file.type)) {
    return "type";
  }
  if (file.size === 0) {
    return "empty";
  }
  if (file.size > rules.maxBytes) {
    return "size";
  }
  return null;
}

/**
 * Where a stored logo or favicon is drawn from.
 *
 * The thumbnail rather than the file: both are drawn at 32 pixels or less,
 * and the 320-pixel preview the upload path made is already a re-encoded
 * image served inline.
 */
export function brandingImageUrl(blobId: string | null): string | null {
  return blobId ? `/api/blobs/${blobId}/thumbnail` : null;
}

/**
 * The icons a page links, and only those.
 *
 * **One source, so the workspace's icon is the only one.** Next.js links
 * `app/favicon.ico` on every page whatever the metadata says, and a browser
 * prefers that link because it names a size, so the workspace's favicon never
 * reached the tab. The product's two icons now sit in `public/` at the same
 * addresses and are linked from here when the workspace has none.
 */
export function tabIcons(
  favicon: string | null,
): { readonly url: string; readonly sizes?: string; readonly type?: string }[] {
  if (favicon) {
    return [{ url: favicon }];
  }
  return [
    { url: "/favicon.ico", sizes: "48x48", type: "image/x-icon" },
    { url: "/icon.svg", sizes: "any", type: "image/svg+xml" },
  ];
}
