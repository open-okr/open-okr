import { CATALOGUES, translate } from "@openokr/ui";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Who sees the version, and when the newer release shows
 * (docs/design/version-footer.md §3). The checker's own rules are in
 * `update-check.test.ts`; this is the gate around it.
 */

const state = vi.hoisted(() => ({
  cloud: false,
  enabled: true,
  latest: null as { version: string; url: string } | null,
  checked: 0,
}));

vi.mock("../lib/translations", () => ({
  getTranslations: async () => ({
    t: (key: string, values?: Record<string, string | number>) =>
      translate(CATALOGUES.en, key, values),
  }),
}));
vi.mock("../lib/pool", () => ({ getPool: () => ({}) }));
vi.mock("../lib/app-version.ts", () => ({ RUNNING_VERSION: "0.4.0" }));
vi.mock("@openokr/adapters", () => ({ outboundFetch: vi.fn() }));
vi.mock("@openokr/core", async (original) => ({
  ...(await original<typeof import("@openokr/core")>()),
  isCloudEnabled: async () => state.cloud,
  readUpdateCheck: async () => ({ value: state.enabled, source: "default" }),
}));
vi.mock("../lib/update-check.ts", async (original) => ({
  ...(await original<typeof import("../lib/update-check.ts")>()),
  createUpdateChecker: () => ({
    latest: () => {
      state.checked += 1;
      return state.latest;
    },
  }),
}));

const { VersionFooter } = await import("../lib/version-footer.tsx");
const { ACCESS_LEVELS } = await import("@openokr/core");

const render = async (level: number) =>
  renderToString((await VersionFooter({ level })) as ReactNode);

const NEWER = {
  version: "0.5.0",
  url: "https://github.com/open-okr/open-okr/releases/tag/v0.5.0",
};

beforeEach(() => {
  state.cloud = false;
  state.enabled = true;
  state.latest = null;
  state.checked = 0;
});

describe("the version footer", () => {
  it("is nothing for a member without full access", async () => {
    state.latest = NEWER;
    expect(await render(ACCESS_LEVELS.edit)).toBe("");
    expect(state.checked).toBe(0);
  });

  it("shows an administrator the running version", async () => {
    const html = await render(ACCESS_LEVELS.full);
    expect(html).toContain("v0.4.0");
    expect(html).not.toContain("available");
  });

  it("names a newer release and links to it", async () => {
    state.latest = NEWER;
    const html = await render(ACCESS_LEVELS.full);
    expect(html).toContain("v0.5.0 available");
    expect(html).toContain(NEWER.url);
  });

  it("says nothing of a release that is not newer", async () => {
    state.latest = { ...NEWER, version: "0.4.0" };
    expect(await render(ACCESS_LEVELS.full)).not.toContain("available");
  });

  it("does not ask when the check is off, or on a managed cloud", async () => {
    state.latest = NEWER;
    state.enabled = false;
    expect(await render(ACCESS_LEVELS.full)).not.toContain("available");
    state.enabled = true;
    state.cloud = true;
    expect(await render(ACCESS_LEVELS.full)).toContain("v0.4.0");
    expect(state.checked).toBe(0);
  });
});
