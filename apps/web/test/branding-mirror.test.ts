import { describe, expect, it } from "vitest";
import { mirrorOf } from "../lib/branding-mirror.ts";

/** What the Branding page's live mirror draws (docs/design/branding-page.md §3). */

const saved = {
  stored: "#c7d2fe",
  fill: "#5b63d6",
  logoUrl: "/api/blobs/logo/thumbnail",
  faviconUrl: null,
};

describe("the branding mirror", () => {
  it("draws what is in force when nothing is pending", () => {
    expect(mirrorOf(saved, {})).toEqual({
      brand: "#5b63d6",
      logoUrl: "/api/blobs/logo/thumbnail",
      faviconUrl: null,
      unsaved: [],
    });
  });

  it("draws the product's own colour when nothing is stored", () => {
    const none = { stored: null, fill: null, logoUrl: null, faviconUrl: null };
    expect(mirrorOf(none, {}).brand).toBeNull();
  });

  it("draws a typed colour before Save and says it is not saved", () => {
    const look = mirrorOf(saved, { colour: "#0e7490" });
    expect(look.brand).toBe("#0e7490");
    expect(look.unsaved).toEqual(["colour"]);
  });

  it("treats the stored colour typed again as saved, and keeps its darkened fill", () => {
    const look = mirrorOf(saved, { colour: "#c7d2fe" });
    expect(look.brand).toBe("#5b63d6");
    expect(look.unsaved).toEqual([]);
  });

  it("draws chosen images before Save, in the order the page lists them", () => {
    const look = mirrorOf(saved, {
      faviconUrl: "blob:favicon",
      logoUrl: "blob:logo",
      colour: "#0e7490",
    });
    expect(look.logoUrl).toBe("blob:logo");
    expect(look.faviconUrl).toBe("blob:favicon");
    expect(look.unsaved).toEqual(["colour", "logo", "favicon"]);
  });
});
