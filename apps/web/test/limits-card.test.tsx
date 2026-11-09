import { TranslationsProvider } from "@openokr/ui";
import { type ComponentProps, createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * The limits card on S-36 (plan 0.7.0 B10).
 *
 * On a cloud the storage quota and the agent cost cap are the provider's
 * levers (Akmal's choice of 9 November 2026), so the card names them and who
 * sets them and posts no field for either. On a self-hosted instance all five
 * are the administrator's.
 */

vi.mock("../app/admin/general/limits-actions", () => ({
  submitLimits: vi.fn(),
}));

const { LimitsCard } = await import("../app/admin/general/limits-card");

const LIMITS = {
  storageQuotaBytes: 5 * 1024 ** 3,
  exportInlineRowLimit: 5000,
  importRowLimit: 1000,
  messageLogRetentionDays: 0,
  agentRunCostCapUsd: 2,
};

const rendered = (providerSetsTwo: boolean, canManage = true): string =>
  renderToString(
    createElement(
      TranslationsProvider,
      { locale: "en" } as ComponentProps<typeof TranslationsProvider>,
      createElement(LimitsCard, { limits: LIMITS, providerSetsTwo, canManage }),
    ),
  );

describe("the limits card", () => {
  it("offers all five on a self-hosted instance", () => {
    const html = rendered(false);
    for (const name of [
      "storageQuotaGigabytes",
      "agentRunCostCapUsd",
      "exportInlineRowLimit",
      "importRowLimit",
      "messageLogRetentionDays",
    ]) {
      expect(html).toContain(`name="${name}"`);
    }
  });

  it("on a cloud, names the provider's two and posts no field for them", () => {
    const html = rendered(true);
    expect(html).not.toContain('name="storageQuotaGigabytes"');
    expect(html).not.toContain('name="agentRunCostCapUsd"');
    expect(html).toContain("set by your provider, 5 GB");
    expect(html).toContain('name="importRowLimit"');
  });

  it("offers no buttons to somebody below full access", () => {
    expect(rendered(false, false)).not.toContain('value="save"');
  });
});
