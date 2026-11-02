import { BRANDING_IMAGE_MAX_BYTES, BRANDING_IMAGE_TYPES } from "@openokr/core";
import { describe, expect, it } from "vitest";
import {
  brandingImageProblem,
  brandingImageUrl,
  tabIcons,
} from "../lib/branding-image.ts";

/**
 * The browser's own check on a chosen logo or favicon
 * (docs/design/workspace-logo-favicon.md §3). The server action is the
 * enforcement; this is what lets the preview refuse at once.
 */
const rules = {
  types: [...BRANDING_IMAGE_TYPES],
  maxBytes: BRANDING_IMAGE_MAX_BYTES,
};

describe("a chosen branding image", () => {
  it("is accepted as a PNG, JPEG or WebP within the ceiling", () => {
    for (const type of ["image/png", "image/jpeg", "image/webp"]) {
      expect(brandingImageProblem({ type, size: 1024 }, rules)).toBeNull();
    }
    expect(
      brandingImageProblem(
        { type: "image/png", size: BRANDING_IMAGE_MAX_BYTES },
        rules,
      ),
    ).toBeNull();
  });

  it("is refused as SVG, GIF or anything else", () => {
    for (const type of ["image/svg+xml", "image/gif", "application/pdf", ""]) {
      expect(brandingImageProblem({ type, size: 1024 }, rules)).toBe("type");
    }
  });

  it("is refused over 2 MB, and when empty", () => {
    expect(
      brandingImageProblem(
        {
          type: "image/png",
          size: BRANDING_IMAGE_MAX_BYTES + 1,
        },
        rules,
      ),
    ).toBe("size");
    expect(brandingImageProblem({ type: "image/png", size: 0 }, rules)).toBe(
      "empty",
    );
  });
});

describe("a stored branding image", () => {
  it("is drawn from its thumbnail, which every member can read", () => {
    expect(brandingImageUrl("0b0b-id")).toBe("/api/blobs/0b0b-id/thumbnail");
    expect(brandingImageUrl(null)).toBeNull();
  });
});

describe("the tab icons a page links", () => {
  it("are the product's two icons when the workspace has no favicon", () => {
    expect(tabIcons(null)).toEqual([
      { url: "/favicon.ico", sizes: "48x48", type: "image/x-icon" },
      { url: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ]);
  });

  // A browser prefers a link that names its size, so the product's 48-pixel
  // icon beside the workspace's would win the tab (found 2 November 2026).
  it("are the workspace's favicon alone when it has one", () => {
    expect(tabIcons("/api/blobs/b/thumbnail")).toEqual([
      { url: "/api/blobs/b/thumbnail" },
    ]);
  });
});
