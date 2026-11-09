import { CATALOGUES, translate } from "@openokr/ui";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * The console-mail banner on Admin, General says what the log really holds
 * (plan 0.7.0, B7).
 *
 * It told every operator that the log held each message's recipient, subject
 * and body, and that password-reset links were sitting in it. Since
 * completeness review L-12 the driver masks the address and withholds the
 * body in production, so the banner was warning a production operator about
 * a credential that was not there and not telling them what was.
 */

vi.mock("../lib/translations", () => ({
  getTranslations: async () => ({
    t: (key: string, values?: Record<string, string | number>) =>
      translate(CATALOGUES.en, key, values),
  }),
}));

const { ConsoleMailNotice } = await import(
  "../app/admin/general/console-mail-notice"
);

const rendered = async (revealsContent: boolean): Promise<string> =>
  renderToString(await ConsoleMailNotice({ revealsContent }));

describe("the console-mail banner", () => {
  it("in production, says the log keeps a masked address and the subject, never the body", async () => {
    const html = await rendered(false);
    expect(html).toContain("masked");
    expect(html).toContain("never the body");
    // The claims that were wrong in production.
    expect(html).not.toContain("the subject and the body");
    expect(html).not.toContain("sitting in the log");
    expect(html).not.toContain("link in a log is a credential");
  });

  it("on a developer's machine, says the whole message is in the log", async () => {
    const html = await rendered(true);
    expect(html).toContain("the subject and the body");
    expect(html).toContain("link in a log is a credential");
  });

  it("tells both to set up SMTP", async () => {
    for (const reveals of [true, false]) {
      expect(await rendered(reveals)).toContain("SMTP");
    }
  });
});
