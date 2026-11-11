import { CATALOGUES, translate } from "@openokr/ui";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * The notice on Admin, General for a database role that bypasses row-level
 * security (H-B). It replaces what `/api/health` used to say to anybody.
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

const rendered = async (props: {
  tenantFloorBypassed: boolean;
  schedulerFailed: boolean;
}): Promise<string> => renderToString(await InstanceHealthNotice(props));

describe("the instance health notice", () => {
  it("says isolation is off and how to fix it when the role bypasses the floor", async () => {
    const html = await rendered({
      tenantFloorBypassed: true,
      schedulerFailed: false,
    });
    expect(html).toContain('data-testid="tenant-floor-notice"');
    expect(html).toContain("not enforcing workspace isolation");
    expect(html).toContain("Connect as a role with neither privilege");
    expect(html).not.toContain("scheduler-notice");
  });

  it("renders nothing when the floor holds and the scheduler runs", async () => {
    expect(
      await rendered({ tenantFloorBypassed: false, schedulerFailed: false }),
    ).toBe("");
  });
});
