import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BRAND_SURFACES } from "@openokr/core";
import { CATALOGUES, TranslationsProvider, translate } from "@openokr/ui";
import { type ComponentProps, createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The workspace's brand colour, applied (completeness review M-14).
 *
 * The branding card saved a colour and said it was "in force across this
 * workspace" while every screen stayed indigo. These prove the other half:
 * that the saved colour becomes the style sheet the root layout sets, that
 * the card's save refuses a status hue in words, and that what the card says
 * is in force is what the layout applies.
 */

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const TOKENS = readFileSync(
  join(ROOT, "packages", "ui", "src", "styles", "tokens.css"),
  "utf8",
);

/** The custom properties one selector block of tokens.css declares. */
function block(selector: string): Record<string, string> {
  const start = TOKENS.indexOf(`${selector} {`);
  const body = TOKENS.slice(start, TOKENS.indexOf("\n}", start));
  return Object.fromEntries(
    [...body.matchAll(/^\s{2}(--[\w-]+):\s*([^;]+);/gm)].map((match) => [
      match[1],
      (match[2] ?? "").trim(),
    ]),
  );
}

const callAction = vi.fn();
const revalidatePath = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}));
vi.mock("../lib/translations", () => ({
  getTranslations: async () => ({
    t: (key: string, values?: Record<string, string | number>) =>
      translate(CATALOGUES.en, key, values),
  }),
}));
vi.mock("../lib/workspace", () => ({
  requireWorkspace: async () => ({
    session: { user: { id: "user-1" } },
    workspace: { workspaceId: "workspace-1", memberId: "member-1" },
    memberships: [],
  }),
}));
vi.mock("../lib/auth", () => ({ getPool: () => ({}) }));
vi.mock("../lib/pool", () => ({ getPool: () => ({}) }));
vi.mock("@openokr/core", async (original) => ({
  ...(await original<typeof import("@openokr/core")>()),
  callAction: (...args: unknown[]) => callAction(...args),
}));

const { brandStyleSheet } = await import("../lib/workspace-presentation");
const { submitBranding } = await import("../app/admin/branding/actions");
const { default: BrandingPage } = await import("../app/admin/branding/page");

beforeEach(() => {
  callAction.mockReset();
  revalidatePath.mockReset();
});

describe("the surfaces the palette is measured against", () => {
  it("are the ones tokens.css draws", () => {
    // Repeated in core so a page render never reads a file. A re-themed
    // surface has to move both, or every contrast the palette promises is
    // measured against a colour no screen uses.
    const light = block(":root");
    const dark = block(':root[data-theme="dark"]');
    for (const [name, value] of Object.entries(BRAND_SURFACES.light)) {
      expect([name, light[`--${name}`]]).toEqual([name, value]);
    }
    for (const [name, value] of Object.entries(BRAND_SURFACES.dark)) {
      expect([name, dark[`--${name}`]]).toEqual([name, value]);
    }
  });
});

describe("the style sheet the root layout sets", () => {
  it("is nothing without a colour, so tokens.css stands", () => {
    expect(brandStyleSheet(null)).toBeNull();
  });

  it("is nothing for a status hue stored before the schema refused one", () => {
    expect(brandStyleSheet("#22c55e")).toBeNull();
  });

  it("sets every brand token tokens.css declares, on both themes", () => {
    const css = brandStyleSheet("#7c3aed") ?? "";
    expect(css.startsWith(":root:root{--brand:#7c3aed;")).toBe(true);
    const [light, dark] = css.split(":root:root[data-theme=dark]");
    const declared = Object.keys(block(":root")).filter((name) =>
      /^--brand(-|$)/.test(name),
    );
    expect(declared.length).toBeGreaterThan(5);
    for (const token of declared) {
      expect(light).toContain(`${token}:#`);
      expect(dark).toContain(`${token}:#`);
    }
  });

  it("holds nothing React would escape inside a style element", () => {
    // A quote would reach the browser as &quot; and break the selector.
    expect(brandStyleSheet("#336699")).not.toMatch(/["'<>&]/);
  });

  it("is set by the root layout, with the nonce proxy.ts requires", () => {
    const layout = readFileSync(
      fileURLToPath(new URL("../app/layout.tsx", import.meta.url)),
      "utf8",
    );
    expect(layout).toContain("await workspaceBrandStyleSheet()");
    expect(layout).toContain("<style nonce={nonce}>{brandStyle}</style>");
  });
});

/** The form a browser submits, with the button that was pressed. */
function submitted(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    form.set(name, value);
  }
  return form;
}

const NOTHING = { error: null, saved: null };

describe("saving the branding card", () => {
  it("saves a colour, and redraws every screen rather than this one", async () => {
    callAction.mockResolvedValue({});
    const state = await submitBranding(
      NOTHING,
      submitted({ intent: "save", primaryColor: "#7C3AED" }),
    );

    expect(state).toEqual({ error: null, saved: "Saved." });
    expect(callAction).toHaveBeenCalledWith(
      expect.anything(),
      "settings.updateWorkspaceBranding",
      { branding: { primaryColor: "#7C3AED" } },
    );
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("clears the colour when the field is emptied", async () => {
    callAction.mockResolvedValue({});
    await submitBranding(
      NOTHING,
      submitted({ intent: "save", primaryColor: "" }),
    );
    expect(callAction).toHaveBeenCalledWith(
      expect.anything(),
      "settings.updateWorkspaceBranding",
      { branding: {} },
    );
  });

  it.each([
    ["#22c55e", "reads as green, which means on track"],
    ["#f59e0b", "reads as amber, which means at risk"],
    ["#ef4444", "reads as red, which means off track"],
  ])("refuses %s in words, and writes nothing", async (colour, reason) => {
    const state = await submitBranding(
      NOTHING,
      submitted({ intent: "save", primaryColor: colour }),
    );
    expect(state.error).toContain(colour);
    expect(state.error).toContain(reason);
    expect(state.saved).toBeNull();
    expect(callAction).not.toHaveBeenCalled();
  });

  it("refuses something that is not a hex colour", async () => {
    const state = await submitBranding(
      NOTHING,
      submitted({ intent: "save", primaryColor: "blue" }),
    );
    expect(state.error).toBe(
      "A hash followed by six hex digits, like #336699.",
    );
    expect(callAction).not.toHaveBeenCalled();
  });

  it("resets the card from the same form", async () => {
    callAction.mockResolvedValue({});
    const state = await submitBranding(NOTHING, submitted({ intent: "reset" }));
    expect(callAction).toHaveBeenCalledWith(
      expect.anything(),
      "settings.resetWorkspaceSettings",
      { card: "branding" },
    );
    expect(state.saved).toBe("Back to the product’s own colour.");
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
});

/** The card as the admin screen renders it, over what is stored. */
async function renderCard(branding: Record<string, unknown>): Promise<string> {
  callAction.mockResolvedValue({
    workspaceId: "workspace-1",
    settings: { branding },
  });
  const page = (await BrandingPage()) as ReactNode;
  return renderToString(
    createElement(
      TranslationsProvider,
      { locale: "en" } as ComponentProps<typeof TranslationsProvider>,
      page,
    ),
  );
}

describe("reading the branding card back", () => {
  it("says a stored colour is in force, and draws it", async () => {
    const html = await renderCard({ primaryColor: "#7c3aed" });
    expect(html).toContain('value="#7c3aed"');
    expect(html).toContain("#7c3aed is in force on every screen");
    expect(html).toContain("background-color:#7c3aed");
  });

  it("says which shade is in force when the colour was too light for white text", async () => {
    const html = await renderCard({ primaryColor: "#c7d2fe" });
    expect(html).toContain("#c7d2fe is too light to carry white text");
    expect(html).not.toContain("background-color:#c7d2fe");
  });

  it("says a stored status hue is not applied, and draws no swatch", async () => {
    const html = await renderCard({ primaryColor: "#22c55e" });
    expect(html).toContain("#22c55e reads as red, amber or green");
    expect(html).toContain("so it is not applied");
    expect(html).not.toContain("background-color");
  });

  it("says the product's own colour is in force when nothing is stored", async () => {
    const html = await renderCard({});
    expect(html).toContain("Empty uses the product’s own theme.");
  });
});
