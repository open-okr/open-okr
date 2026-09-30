import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { SharpImageProcessor } from "../src/drivers/image/sharp.ts";

/**
 * The image driver (completeness review M-24, TECHNICAL-PLAN §8.2).
 *
 * Every fixture is drawn here with sharp itself, so the suite carries no binary
 * files and each one says what it holds. The EXIF fixture is the one that
 * matters: a photo's metadata names the camera and, from a phone, where it was
 * taken, and the whole point of re-encoding is that none of it survives.
 */

const processor = new SharpImageProcessor();

const OPTIONS = { thumbnailEdge: 32, maxPixels: 10_000_000 } as const;

/** A 200 by 100 JPEG with a camera name, a GPS position and an orientation. */
async function photoWithExif(): Promise<Buffer> {
  return sharp({
    create: { width: 200, height: 100, channels: 3, background: "#c03030" },
  })
    .withMetadata({ orientation: 6 })
    .withExif({
      IFD0: { Make: "M24TestCam", Model: "Leaky 1" },
      IFD3: {
        GPSLatitudeRef: "N",
        GPSLatitude: "3/1 8/1 0/1",
        GPSLongitudeRef: "E",
        GPSLongitude: "101/1 41/1 0/1",
      },
    })
    .jpeg()
    .toBuffer();
}

const png = (width: number, height: number) =>
  sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 120, b: 200, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer();

describe("re-encoding an uploaded image", () => {
  it("leaves the EXIF block behind, GPS and camera name included", async () => {
    const original = await photoWithExif();
    // The fixture really does carry what the test says it removes.
    const before = await sharp(original).metadata();
    expect(before.exif).toBeDefined();
    expect(original.includes(Buffer.from("M24TestCam"))).toBe(true);

    const result = await processor.process(original, {
      ...OPTIONS,
      contentType: "image/jpeg",
    });
    if (result.kind !== "processed") {
      throw new Error(`expected a processed image, got ${result.reason}`);
    }

    const after = await sharp(result.image.body).metadata();
    expect(after.format).toBe("jpeg");
    expect(after.exif).toBeUndefined();
    expect(after.xmp).toBeUndefined();
    expect(after.iptc).toBeUndefined();
    expect(result.image.body.includes(Buffer.from("M24TestCam"))).toBe(false);
    expect(result.image.contentType).toBe("image/jpeg");
  });

  it("applies the orientation to the pixels before the tag is dropped", async () => {
    // Orientation 6 is a quarter turn: a phone held upright records a
    // landscape sensor image and a tag saying so. Losing the tag without
    // turning the pixels would lay every portrait photo on its side.
    const result = await processor.process(await photoWithExif(), {
      ...OPTIONS,
      contentType: "image/jpeg",
    });
    if (result.kind !== "processed") {
      throw new Error("expected a processed image");
    }
    expect(result.image.width).toBe(100);
    expect(result.image.height).toBe(200);
    expect((await sharp(result.image.body).metadata()).orientation).toBe(
      undefined,
    );
  });

  it("writes the image back in the type that was claimed", async () => {
    // A JPEG saved under a `.png` name arrives claiming PNG, because the
    // browser reads the name. What is stored is then really a PNG.
    const jpeg = await photoWithExif();
    const result = await processor.process(jpeg, {
      ...OPTIONS,
      contentType: "image/png",
    });
    if (result.kind !== "processed") {
      throw new Error("expected a processed image");
    }
    expect(result.image.contentType).toBe("image/png");
    expect((await sharp(result.image.body).metadata()).format).toBe("png");
  });

  it("keeps an animation when the claimed type can carry one", async () => {
    const frame = (background: string) =>
      sharp({ create: { width: 12, height: 12, channels: 4, background } })
        .png()
        .toBuffer();
    const animation = await sharp([await frame("#0c0"), await frame("#00c")], {
      join: { animated: true },
    })
      .gif()
      .toBuffer();

    const result = await processor.process(animation, {
      ...OPTIONS,
      contentType: "image/gif",
    });
    if (result.kind !== "processed") {
      throw new Error("expected a processed image");
    }
    const meta = await sharp(result.image.body, { animated: true }).metadata();
    expect(meta.pages).toBe(2);
    // One frame's height, not the strip the frames are stored in.
    expect(result.image.height).toBe(12);
  });
});

describe("the thumbnail", () => {
  it("fits inside the edge it was given and is a WebP", async () => {
    const result = await processor.process(await png(400, 100), {
      ...OPTIONS,
      contentType: "image/png",
    });
    if (result.kind !== "processed") {
      throw new Error("expected a processed image");
    }
    expect(result.thumbnail.contentType).toBe("image/webp");
    expect(result.thumbnail.width).toBe(32);
    expect(result.thumbnail.height).toBe(8);
    const meta = await sharp(result.thumbnail.body).metadata();
    expect(meta.format).toBe("webp");
    expect([meta.width, meta.height]).toEqual([32, 8]);
  });

  it("is never enlarged past the image it shows", async () => {
    const result = await processor.process(await png(10, 6), {
      ...OPTIONS,
      contentType: "image/png",
    });
    if (result.kind !== "processed") {
      throw new Error("expected a processed image");
    }
    expect([result.thumbnail.width, result.thumbnail.height]).toEqual([10, 6]);
  });
});

describe("what is refused", () => {
  it("refuses bytes that are not an image, whatever the name claimed", async () => {
    const result = await processor.process(
      Buffer.from("%PDF-1.7 this is not a picture of anything"),
      { ...OPTIONS, contentType: "image/png" },
    );
    expect(result).toEqual({ kind: "unreadable", reason: "not_an_image" });
  });

  it("refuses an image sharp could read and the allow-list does not name", async () => {
    // libvips rasterises SVG. The allow-list excludes SVG because it carries
    // script, and a decoder nobody asked for is a parser a stranger reaches.
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>',
    );
    const result = await processor.process(svg, {
      ...OPTIONS,
      contentType: "image/png",
    });
    expect(result).toEqual({ kind: "unreadable", reason: "not_an_image" });
  });

  it("refuses an image with more pixels than the ceiling, before decoding it", async () => {
    const result = await processor.process(await png(200, 200), {
      ...OPTIONS,
      contentType: "image/png",
      maxPixels: 100 * 100,
    });
    expect(result).toEqual({ kind: "unreadable", reason: "too_many_pixels" });
  });

  it("says so when asked to write a type it does not write", async () => {
    const result = await processor.process(await png(4, 4), {
      ...OPTIONS,
      contentType: "application/pdf",
    });
    expect(result).toEqual({ kind: "unreadable", reason: "unsupported_type" });
  });
});
