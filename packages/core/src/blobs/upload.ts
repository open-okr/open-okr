/**
 * One upload, from the bytes a browser sent to a claimed blob (TECHNICAL-PLAN
 * §4.9 and §8.2, completeness review M-24).
 *
 * **Why this is in core rather than in the server action that used to hold
 * it.** The order is the contract: validate, re-encode, prepare, put, claim.
 * Written in `apps/web` it was one caller's habit; here it is one function
 * every caller shares and the suite can drive with both ports faked.
 *
 * **The ports arrive from the host.** `packages/core` does not import
 * `packages/adapters`, so the image processor and the storage are declared
 * here by shape and the app passes the drivers it already built, the way
 * `ActionCallContext.storage` reaches the orphan reap.
 *
 * **An image is re-encoded before anything is reserved.** A file that is not
 * the image it claims to be is refused without a pending row, a storage key or
 * a byte written, so a refusal leaves nothing for the orphan reap to find. The
 * quota is checked against the re-encoded size, which is what is stored.
 */
import { createHash } from "node:crypto";
import type { ActionCallContext } from "../actions/define.ts";
import { callAction } from "../actions/registry.ts";
import { OperationError } from "../operations/errors.ts";
import {
  IMAGE_CONTENT_TYPES,
  MAX_IMAGE_PIXELS,
  THUMBNAIL_CONTENT_TYPE,
  THUMBNAIL_EDGE,
  thumbnailKeyFor,
  validateUpload,
} from "./validation.ts";

/** Why an image was refused. The `ImageProcessor` port's own reasons. */
export type ImageRefusal =
  | "not_an_image"
  | "unsupported_type"
  | "too_many_pixels";

interface EncodedImage {
  readonly body: Buffer;
  readonly contentType: string;
  readonly width: number;
  readonly height: number;
}

/** The `ImageProcessor` port, by shape. */
export interface ImageProcessing {
  process(
    body: Buffer,
    options: {
      readonly contentType: string;
      readonly thumbnailEdge: number;
      readonly maxPixels: number;
    },
  ): Promise<
    | {
        readonly kind: "processed";
        readonly image: EncodedImage;
        readonly thumbnail: EncodedImage;
      }
    | { readonly kind: "unreadable"; readonly reason: ImageRefusal }
  >;
}

/** The one `FileStorage` method an upload needs, by shape. */
interface UploadStorage {
  put(
    key: string,
    body: Buffer,
    options?: { readonly contentType?: string },
  ): Promise<unknown>;
}

export interface UploadPorts {
  readonly storage: UploadStorage;
  readonly images: ImageProcessing;
}

export interface UploadInput {
  readonly filename: string;
  readonly contentType: string;
  readonly bytes: Buffer;
}

export interface StoredUpload {
  readonly blobId: string;
  /** `scanning` when a virus scanner is configured and has yet to answer. */
  readonly status: "ok" | "scanning";
  readonly warningCrossed: boolean;
}

const REFUSALS: Readonly<Record<ImageRefusal, string>> = {
  not_an_image:
    "This file is named as an image, and it is not one that can be read. Save it again as a PNG, JPEG, GIF or WebP and attach that.",
  unsupported_type: "This image type cannot be stored.",
  too_many_pixels: `This image has more than ${MAX_IMAGE_PIXELS / 1_000_000} megapixels. Make it smaller and attach it again.`,
};

/**
 * An image the processor would not re-encode.
 *
 * An `OperationError`, so a caller that treats every refusal alike still
 * shows the message. `reason` is there for a caller that words it in the
 * reader's own language, which is what the browser does.
 */
export class ImageRefusedError extends OperationError {
  readonly reason: ImageRefusal;

  constructor(reason: ImageRefusal) {
    super("forbidden", REFUSALS[reason]);
    this.name = "ImageRefusedError";
    this.reason = reason;
  }
}

/**
 * Stores one uploaded file and claims it.
 *
 * Throws an `OperationError` for every refusal: a blocked type, a file over
 * the size ceiling or the quota, an image that is not one. Attaching the file
 * to anything is the caller's next step and not this function's, because the
 * subject is the caller's to name.
 */
export async function storeUpload(
  context: ActionCallContext,
  ports: UploadPorts,
  input: UploadInput,
): Promise<StoredUpload> {
  // The allow-list and the ceiling first, on what arrived, so a 200 MB file
  // is refused before anybody decodes it.
  const allowed = validateUpload({
    contentType: input.contentType,
    size: input.bytes.byteLength,
  });
  if (!allowed.ok) {
    throw new OperationError("forbidden", allowed.reason ?? "Invalid upload.");
  }

  let body = input.bytes;
  let preview: EncodedImage | null = null;
  let size: { readonly width: number; readonly height: number } | null = null;
  if (IMAGE_CONTENT_TYPES.has(input.contentType)) {
    const processed = await ports.images.process(input.bytes, {
      contentType: input.contentType,
      thumbnailEdge: THUMBNAIL_EDGE,
      maxPixels: MAX_IMAGE_PIXELS,
    });
    if (processed.kind === "unreadable") {
      throw new ImageRefusedError(processed.reason);
    }
    body = processed.image.body;
    preview = processed.thumbnail;
    size = { width: processed.image.width, height: processed.image.height };
  }

  const reserved = await callAction(context, "blobs.prepareUpload", {
    filename: input.filename,
    contentType: input.contentType,
    declaredSize: body.byteLength,
  });

  await ports.storage.put(reserved.storageKey, body, {
    contentType: input.contentType,
  });
  if (preview) {
    await ports.storage.put(
      thumbnailKeyFor(reserved.storageKey),
      preview.body,
      { contentType: THUMBNAIL_CONTENT_TYPE },
    );
  }

  // **The size and digest of what was written, not of what was promised.**
  // For an image that is the re-encoded file, which is what anybody who
  // downloads it will receive.
  const claimed = await callAction(context, "blobs.claimUpload", {
    blobId: reserved.blobId,
    actualSize: body.byteLength,
    digest: createHash("sha256").update(body).digest("hex"),
    ...(size ? { width: size.width, height: size.height } : {}),
    ...(preview ? { thumbnail: true } : {}),
  });

  return {
    blobId: reserved.blobId,
    status: claimed.status,
    warningCrossed: claimed.warningCrossed,
  };
}
