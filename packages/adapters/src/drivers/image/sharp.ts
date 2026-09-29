/**
 * The image driver, on sharp and libvips (completeness review M-24).
 *
 * **Only four decoders, whatever sharp can read.** libvips will rasterise an
 * SVG, open a TIFF or a HEIF and more besides, and every extra format is one
 * more parser a stranger's bytes reach. The upload allow-list names four image
 * types, so the bytes must turn out to be one of those four or the file is
 * refused, even when sharp could have read it.
 *
 * **Written back in the type that was claimed.** A browser picks the type from
 * the file's name, so a JPEG saved as `photo.png` arrives claiming PNG. Writing
 * the pixels out as PNG makes the name, the recorded type and the bytes agree,
 * which refusing it would not, and which the person who uploaded it never
 * asked to think about. A transparent image claimed as JPEG is laid on white,
 * because JPEG has no transparency.
 *
 * **Metadata is left behind by default.** sharp writes no EXIF, XMP or IPTC
 * unless told to, and this driver never tells it to. The orientation a phone
 * records in EXIF is applied to the pixels first, so a portrait photo stays
 * upright once the tag that said so is gone.
 *
 * **The thumbnail is made from the re-encoded image**, never from what
 * arrived, so it is a picture of what is stored.
 *
 * **sharp is loaded on first use, not when this module is.** The package
 * index re-exports every driver, and the storage, mail and relay code all
 * import that index. A static import would load libvips into every process
 * that touches the adapters, the importer and the scheduler included, and a
 * platform binary missing from an image would then stop the whole product
 * rather than image uploads alone.
 */
import type { Metadata, Sharp } from "sharp";
import type {
  EncodedImage,
  ImageFormat,
  ImageProcessOptions,
  ImageProcessor,
  ImageProcessResult,
} from "../../ports/image.ts";

const TARGETS: Readonly<Record<string, ImageFormat>> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

/** What the bytes may decode as. The same four, named as sharp names them. */
const READABLE: ReadonlySet<string> = new Set(["jpeg", "png", "gif", "webp"]);

/** A format that can carry more than one frame, so an animation survives. */
const ANIMATED_TARGETS: ReadonlySet<ImageFormat> = new Set(["gif", "webp"]);

/** High enough that a person looking at a photo does not see the re-encode. */
const QUALITY = 90;
const THUMBNAIL_QUALITY = 80;

/**
 * Tolerate warnings, refuse errors. libvips warns about a JPEG with a few bytes
 * missing from its end, which phones and old cameras produce and every viewer
 * opens; it errors on bytes it cannot decode at all.
 */
const FAIL_ON = "error" as const;

type SharpFactory = typeof import("sharp").default;

let loading: Promise<SharpFactory> | undefined;

/** The sharp factory, imported once per process on the first image. */
function loadSharp(): Promise<SharpFactory> {
  loading ??= import("sharp").then(
    (module) => module.default,
    (error: unknown) => {
      // Said plainly, because the underlying message names a platform
      // package and a reader has to work out that it means "the image was
      // built without its image library".
      loading = undefined;
      throw new Error(
        `Images cannot be processed: sharp could not be loaded (${
          error instanceof Error ? error.message : String(error)
        }).`,
      );
    },
  );
  return loading;
}

export class SharpImageProcessor implements ImageProcessor {
  async process(
    body: Buffer,
    options: ImageProcessOptions,
  ): Promise<ImageProcessResult> {
    const target = TARGETS[options.contentType];
    if (!target) {
      return { kind: "unreadable", reason: "unsupported_type" };
    }
    const sharp = await loadSharp();

    let metadata: Metadata;
    try {
      metadata = await sharp(body, { failOn: FAIL_ON }).metadata();
    } catch {
      return { kind: "unreadable", reason: "not_an_image" };
    }
    if (!metadata.format || !READABLE.has(metadata.format)) {
      return { kind: "unreadable", reason: "not_an_image" };
    }

    // Counted from the header, before any pixel is decoded. `height` is one
    // frame's height here, because the image was opened without `animated`.
    const frames = metadata.pages ?? 1;
    const pixels = (metadata.width ?? 0) * (metadata.height ?? 0) * frames;
    if (pixels > options.maxPixels) {
      return { kind: "unreadable", reason: "too_many_pixels" };
    }

    const animated = frames > 1 && ANIMATED_TARGETS.has(target);

    try {
      const image = await encode(
        sharp(body, {
          failOn: FAIL_ON,
          animated,
          // The same ceiling again, enforced by libvips itself, in case the
          // header and the decoder disagree about how big the image is.
          limitInputPixels: options.maxPixels,
        }).autoOrient(),
        target,
      );

      const thumbnail = await sharp(image.body, { failOn: FAIL_ON })
        .resize({
          width: options.thumbnailEdge,
          height: options.thumbnailEdge,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: THUMBNAIL_QUALITY })
        .toBuffer({ resolveWithObject: true });

      return {
        kind: "processed",
        image,
        thumbnail: {
          body: thumbnail.data,
          contentType: "image/webp",
          width: thumbnail.info.width,
          height: thumbnail.info.height,
        },
      };
    } catch {
      // The header read and the pixels did not: a truncated or corrupt body,
      // or one past the pixel ceiling libvips enforces while decoding.
      return { kind: "unreadable", reason: "not_an_image" };
    }
  }
}

async function encode(
  pipeline: Sharp,
  target: ImageFormat,
): Promise<EncodedImage> {
  const written = await writer(pipeline, target).toBuffer({
    resolveWithObject: true,
  });
  return {
    body: written.data,
    contentType: `image/${target}`,
    width: written.info.width,
    // An animation is one tall strip of frames; the image is one frame high.
    height: written.info.pageHeight ?? written.info.height,
  };
}

function writer(pipeline: Sharp, target: ImageFormat): Sharp {
  switch (target) {
    case "jpeg":
      return pipeline
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .jpeg({ quality: QUALITY });
    case "png":
      return pipeline.png();
    case "gif":
      return pipeline.gif();
    case "webp":
      return pipeline.webp({ quality: QUALITY });
  }
}
