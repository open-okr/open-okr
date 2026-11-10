import { CATALOGUES, translate } from "@openokr/ui";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * The instance notices on Admin, General, and the one plan 0.8.0 H2 adds
 * (docs/design/trusted-proxies.md D12).
 *
 * A process that has met a caller it could not place is counting every such
 * caller as one, so every per-address limit is shared. A correct deployment
 * never meets one, so the notice says what it means and which variable to set.
 * A managed cloud's operator reads the metric and the log instead, so its
 * customers' administrators are never shown it.
 */

vi.mock("../lib/translations", () => ({
  getTranslations: async () => ({
    t: (key: string, values?: Record<string, string | number>) =>
      translate(CATALOGUES.en, key, values),
  }),
}));

const { InstanceHealthNotice } = await import(
  "../app/admin/general/instance-health-notice"
);

const rendered = async (
  props: Partial<Parameters<typeof InstanceHealthNotice>[0]>,
): Promise<string> =>
  renderToString(
    await InstanceHealthNotice({
      tenantFloorBypassed: false,
      schedulerFailed: false,
      unplacedCallers: false,
      cloud: false,
      ...props,
    }),
  );

describe("the caller address notice", () => {
  it("is shown on a self-hosted instance that has met a caller it could not place", async () => {
    const html = await rendered({ unplacedCallers: true });
    expect(html).toContain('data-testid="caller-address-notice"');
    expect(html).toContain("OPENOKR_TRUSTED_PROXIES");
    expect(html).toContain("OPENOKR_CLIENT_ADDRESS_HEADER");
    // The guide that says which to set for each topology.
    expect(html).toMatch(/href="[^"]*docs\/install\/[^"]*"/);
  });

  it("is not shown when every caller was placed", async () => {
    expect(await rendered({})).toBe("");
  });

  it("is not shown on a managed cloud, whose operator reads the metric", async () => {
    expect(await rendered({ unplacedCallers: true, cloud: true })).toBe("");
  });

  it("sits beside the tenant-floor notice rather than replacing it", async () => {
    const html = await rendered({
      tenantFloorBypassed: true,
      unplacedCallers: true,
    });
    expect(html).toContain('data-testid="tenant-floor-notice"');
    expect(html).toContain('data-testid="caller-address-notice"');
  });
});
