import { CATALOGUES, translate } from "@openokr/ui";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * The warnings on the operator's Instance page. One line per warning, each in
 * the catalogue, none of them a refusal.
 */

vi.mock("../lib/translations", () => ({
  getTranslations: async () => ({
    t: (key: string, values?: Record<string, string | number>) =>
      translate(CATALOGUES.en, key, values),
  }),
}));

const { PreflightNotice } = await import(
  "../app/operator/instance/preflight-notice"
);

const rendered = async (
  warnings: Parameters<typeof PreflightNotice>[0]["warnings"],
): Promise<string> => renderToString(await PreflightNotice({ warnings }));

describe("the cloud preflight notice", () => {
  it("renders nothing when there is nothing to warn about", async () => {
    expect(await rendered([])).toBe("");
  });

  it("names console mail", async () => {
    const html = await rendered(["mail_console"]);
    expect(html).toContain('data-testid="cloud-preflight-mail_console"');
    expect(html).toContain("no email leaves the server");
  });

  it("names a missing terms address", async () => {
    const html = await rendered(["terms_missing"]);
    expect(html).toContain('data-testid="cloud-preflight-terms_missing"');
    expect(html).toContain("OPENOKR_TERMS_URL");
  });

  it("names a missing privacy address", async () => {
    const html = await rendered(["privacy_missing"]);
    expect(html).toContain('data-testid="cloud-preflight-privacy_missing"');
    expect(html).toContain("OPENOKR_PRIVACY_URL");
  });

  it("names a retention window of zero", async () => {
    const html = await rendered(["retention_zero"]);
    expect(html).toContain('data-testid="cloud-preflight-retention_zero"');
    expect(html).toContain("never erased");
  });
});
