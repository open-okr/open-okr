import { CATALOGUES, translate } from "@openokr/ui";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * The operator's notice on the console's Instance screen (plan 0.8.0 V2,
 * docs/design/version-footer.md §9). Before 0.8.0 nobody on a managed cloud
 * was told a newer release existed, the operator included.
 */

vi.mock("../lib/translations", () => ({
  getTranslations: async () => ({
    t: (key: string, values?: Record<string, string | number>) =>
      translate(CATALOGUES.en, key, values),
  }),
}));

const { OperatorVersionCard } = await import(
  "../app/operator/instance/version-card.tsx"
);

const render = async (
  check: Parameters<typeof OperatorVersionCard>[0]["check"],
) =>
  renderToString(
    (await OperatorVersionCard({ running: "0.7.0", check })) as ReactNode,
  );

const NEWER = {
  version: "0.8.0",
  url: "https://github.com/open-okr/open-okr/releases/tag/v0.8.0",
};

describe("the operator's version card", () => {
  it("names the running version", async () => {
    const html = await render({ enabled: true, newer: null });
    expect(html).toContain("This instance runs v0.7.0.");
    expect(html).toContain("No newer release is known.");
  });

  it("links a newer release and the upgrade notes it shipped with", async () => {
    const html = await render({ enabled: true, newer: NEWER });
    expect(html).toContain("v0.8.0 available");
    expect(html).toContain(NEWER.url);
    // The newer release's runbook, because that is the procedure for reaching
    // it; the running one may predate a step the upgrade needs.
    expect(html).toContain(
      "https://github.com/open-okr/open-okr/blob/v0.8.0/docs/runbooks/upgrade.md",
    );
  });

  it("says the check is off rather than that nothing is newer", async () => {
    const html = await render({ enabled: false, newer: null });
    expect(html).toContain("The update check is off");
    expect(html).not.toContain("No newer release is known.");
  });
});
