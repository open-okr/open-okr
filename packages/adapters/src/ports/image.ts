/**
 * The ImageProcessor port (TECHNICAL-PLAN §5 and §8.2, completeness review
 * M-24).
 *
 * §8.2 asks for uploaded images to be re-encoded, and the reason is what gets
 * stored. Without it the product keeps the bytes a browser sent under the type
 * the browser claimed, so a file named `.png` holding something else reaches
 * storage, and so does every photo's EXIF block with the GPS position of
 * wherever it was taken. Decoding the pixels and writing them out again makes
 * the claim true and leaves the metadata behind.
 *
 * **A result, not a thrown error, for a file that is not an image.** That is an
 * ordinary answer about somebody's upload rather than a fault, and
 * `packages/core` reads it without importing this package: it declares the
 * same shape and a driver satisfies it structurally, the way `FileStorage`
 * already reaches core.
 */

/** The four image types the upload allow-list accepts. */
export type ImageFormat = "jpeg" | "png" | "gif" | "webp";

/** One encoded image, as it will be stored. */
export interface EncodedImage {
  readonly body: Buffer;
  readonly contentType: string;
  /** In pixels. For an animated image, one frame. */
  readonly width: number;
  readonly height: number;
}

export interface ImageProcessOptions {
  /**
   * The type the upload claimed. The image is written back in it, so the type
   * recorded on the file and the bytes behind it agree.
   */
  readonly contentType: string;
  /** The longest side of the thumbnail, in pixels. Never enlarged past the original. */
  readonly thumbnailEdge: number;
  /**
   * Width times height times frames, above which the image is refused before
   * it is decoded. A small file can declare an enormous canvas, and decoding
   * one is how a 2 MB upload asks the server for gigabytes.
   */
  readonly maxPixels: number;
}

/** Why an image was refused. */
export type UnreadableReason =
  /** The bytes are not an image of an accepted type, whatever the name says. */
  | "not_an_image"
  /** The claimed type is not one of the four this port writes. */
  | "unsupported_type"
  /** More pixels than `maxPixels`. */
  | "too_many_pixels";

export type ImageProcessResult =
  | {
      readonly kind: "processed";
      /** The image, decoded and written again with no metadata. */
      readonly image: EncodedImage;
      /** A small WebP of the first frame. */
      readonly thumbnail: EncodedImage;
    }
  | { readonly kind: "unreadable"; readonly reason: UnreadableReason };

export interface ImageProcessor {
  process(
    body: Buffer,
    options: ImageProcessOptions,
  ): Promise<ImageProcessResult>;
}
