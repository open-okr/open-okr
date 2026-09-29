/**
 * Type and size validation (TECHNICAL-PLAN §4.9, P2-T05).
 *
 * A fixed allow-list and a fixed size ceiling, not a workspace setting: the
 * §4.14 settings map is for choices a workspace actually makes, and nobody
 * has asked to raise a per-file ceiling yet. `storageQuotaBytes` (the total
 * across every file) is the setting; this is a constant until a real need
 * says otherwise.
 *
 * SVG is deliberately absent. It carries script content, and the sanitising
 * allow-list every rendering surface uses (§4) is for rich text, not for
 * files served back verbatim.
 *
 * The same reasoning covers the image constants below: the thumbnail edge and
 * the pixel ceiling are properties of the product, not choices a workspace
 * makes, so they are constants rather than §4.14 settings.
 */
export const ALLOWED_CONTENT_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

/** 25 MiB. */
export const MAX_BLOB_BYTES = 25 * 1024 * 1024;

/**
 * The allowed types that are images, and so are re-encoded and given a
 * thumbnail before they are stored (§8.2, completeness review M-24).
 */
export const IMAGE_CONTENT_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

/**
 * The longest side of a thumbnail, in pixels. The attachment list shows one at
 * 48 CSS pixels, and 320 keeps it sharp on a high-density screen with room for
 * a larger preview later without a second pass over every stored image.
 */
export const THUMBNAIL_EDGE = 320;

/** Thumbnails are WebP whatever the image was: small, and every browser reads it. */
export const THUMBNAIL_CONTENT_TYPE = "image/webp";

/**
 * 100 megapixels, counted across every frame of an animation. A modern phone
 * photo is 12 to 50. The ceiling is on pixels rather than bytes because a
 * compressed file a few megabytes long can declare a canvas that takes
 * gigabytes to decode, and this is checked before anything is decoded.
 */
export const MAX_IMAGE_PIXELS = 100_000_000;

/**
 * Where an image's thumbnail is kept: beside the image, under a key derived
 * from the image's own, so it is inside the same workspace prefix and needs no
 * second name to be chosen.
 */
export function thumbnailKeyFor(storageKey: string): string {
  return `${storageKey}.thumb.webp`;
}

export interface ValidationResult {
  readonly ok: boolean;
  readonly reason?: string;
}

export function validateUpload(input: {
  readonly contentType: string;
  readonly size: number;
}): ValidationResult {
  if (!ALLOWED_CONTENT_TYPES.has(input.contentType)) {
    return { ok: false, reason: `File type not allowed: ${input.contentType}` };
  }
  if (input.size <= 0) {
    return { ok: false, reason: "Empty file." };
  }
  if (input.size > MAX_BLOB_BYTES) {
    return {
      ok: false,
      reason: `File is larger than the ${MAX_BLOB_BYTES} byte limit.`,
    };
  }
  return { ok: true };
}
