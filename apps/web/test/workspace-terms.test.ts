import { ACCESS_LEVELS, navigationFor } from "@openokr/core";
import { TERM_KEYS, TERMINOLOGY } from "@openokr/method";
import { TranslationsProvider } from "@openokr/ui";
import { type ComponentProps, createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { navBlocks, navLabel } from "../lib/nav-groups.ts";

/**
 * A workspace's own words for the method's terms, on its screens
 * (completeness review M-14).
 *
 * The rhythm card saved a rename and `rhythm.read` resolved it, and no screen
 * said it: the Spaces page of a workspace that calls a space a team still said
 * Spaces. This renders that page through the real `getTranslations`, with the
 * rename coming back from `rhythm.read` exactly as the action returns it, so
 * the whole path from the stored label to the heading is the one under test.
 */

/** What `rhythm.read` returns: every term, the canon where nothing changed. */
function resolved(
  renames: Record<string, { singular: string; plural: string }>,
) {
  return {
    ...Object.fromEntries(
      TERM_KEYS.map((term) => [
        term,
        {
          singular: TERMINOLOGY[term].singular,
          plural: TERMINOLOGY[term].plural,
        },
      ]),
    ),
    ...renames,
  };
}

const rhythm = vi.fn();
const callAction = vi.fn();

vi.mock("../lib/rhythm", () => ({
  readRhythmForRequest: () => rhythm(),
}));
vi.mock("../lib/locale", () => ({ resolveLocale: async () => "en" }));
vi.mock("../lib/workspace", () => ({
  requireWorkspace: async () => ({
    session: { user: { id: "user-1" } },
    workspace: { workspaceId: "workspace-1", memberId: "member-1" },
    memberships: [],
  }),
}));
vi.mock("../lib/access", () => ({
  resolveAccessLevelFor: async () => ACCESS_LEVELS.full,
}));
vi.mock("../lib/auth", () => ({ getPool: () => ({}) }));
vi.mock("../lib/pool", () => ({ getPool: () => ({}) }));
vi.mock("../app/spaces/actions.ts", () => ({ createSpace: vi.fn() }));
vi.mock("@openokr/core", async (original) => ({
  ...(await original<typeof import("@openokr/core")>()),
  callAction: (...args: unknown[]) => callAction(...args),
}));

const { default: SpacesPage } = await import("../app/spaces/page");

/** The page as the root layout wraps it, with the same rename handed down. */
async function renderSpaces(
  renamed: ComponentProps<typeof TranslationsProvider>["renamed"],
): Promise<string> {
  const page = (await SpacesPage()) as ReactNode;
  return renderToString(
    createElement(
      TranslationsProvider,
      { locale: "en", renamed } as ComponentProps<typeof TranslationsProvider>,
      page,
    ),
  );
}

beforeEach(() => {
  rhythm.mockReset();
  callAction.mockReset().mockImplementation(async (_context, name) => {
    if (name === "spaces.list" || name === "people.directory") {
      return [];
    }
    throw new Error(`unexpected action ${String(name)}`);
  });
});

describe("the Spaces screen", () => {
  it("says the workspace's own word in its heading, empty state and create card", async () => {
    rhythm.mockResolvedValue({
      terminology: resolved({ space: { singular: "Team", plural: "Teams" } }),
    });
    const html = await renderSpaces({
      space: { singular: "Team", plural: "Teams" },
    });

    expect(html).toContain(">Teams</h1>");
    expect(html).toContain("No teams yet.");
    expect(html).toContain("New team");
    expect(html).toContain("Create the team");
    expect(html).not.toContain(">Spaces</h1>");
  });

  it("says Spaces in a workspace that renamed nothing", async () => {
    rhythm.mockResolvedValue({ terminology: resolved({}) });
    const html = await renderSpaces({});

    expect(html).toContain(">Spaces</h1>");
    expect(html).toContain("No spaces yet.");
    expect(html).toContain("Create the space");
  });

  it("still renders when the rhythm cannot be read, in the product's own words", async () => {
    // The root layout wraps signed-out screens as well, where there is no
    // workspace to ask. A failed read is the product's words, not an error.
    rhythm.mockRejectedValue(new Error("no workspace"));
    const html = await renderSpaces(undefined);

    expect(html).toContain(">Spaces</h1>");
  });
});

describe("the sidebar", () => {
  const items = navigationFor("sidebar", ACCESS_LEVELS.full);
  const renamed = {
    space: { singular: "team", plural: "teams" },
    kpi: { singular: "Metric", plural: "Metrics" },
    cycle: { singular: "Quarter", plural: "Quarters" },
  };

  it("names the entries after the workspace's own words", () => {
    const labels = Object.fromEntries(
      items.map((item) => [item.id, navLabel(item, renamed)]),
    );
    expect(labels.spaces).toBe("Teams");
    expect(labels.kpis).toBe("Metrics");
    expect(labels.cycle).toBe("Quarter");
    // An entry named after no term keeps its registry label.
    expect(labels.goals).toBe("Goals");
  });

  it("heads the Spaces block with the same word", () => {
    const block = navBlocks(items, renamed).find(
      (candidate) => candidate.id === "spaces",
    );
    expect(block?.label).toBe("Teams");
  });

  it("keeps the registry's labels when nothing was renamed", () => {
    for (const item of items) {
      expect(navLabel(item)).toBe(item.label);
    }
    expect(navBlocks(items).map((block) => block.label)).toEqual([
      undefined,
      "Practice",
      "Spaces",
      "Account",
    ]);
  });
});
