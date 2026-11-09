import { CATALOGUES, translate } from "@openokr/ui";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * METHOD.md §4.6's pairs on the rule pages (plan 0.7.0, M1).
 *
 * The committed-objective pair was missing from the code, and it belongs to
 * `quality.committed_floor`, a rule rather than one of the twenty-six checks,
 * so the rule's own page has to show it as a check's page shows its pairs.
 */

vi.mock("../lib/translations", () => ({
  getTranslations: async () => ({
    t: (key: string, values?: Record<string, string | number>) =>
      translate(CATALOGUES.en, key, values),
  }),
}));

const { default: RulePage } = await import("../app/method/[id]/page");

const rendered = async (id: string): Promise<string> => {
  const element = await RulePage({ params: Promise.resolve({ id }) });
  // The examples card is an async component of its own, which the
  // synchronous renderer refuses. The streaming one waits for it.
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return new Response(stream).text();
};

describe("the weak and strong pairs on a rule's page", () => {
  it("shows the committed pair on the committed floor's page", async () => {
    const html = await rendered("quality.committed_floor");
    expect(html).toContain(
      "Committed objective whose key results are all at 0.4 confidence",
    );
    expect(html).toContain(
      "Either find the resources now, or mark it aspirational",
    );
  });

  it("still shows a check's own pair on its page", async () => {
    const html = await rendered("OBJ-1");
    expect(html).toContain("Launch the new mobile app by end of Q3");
  });

  it("shows no pairs on a rule that has none", async () => {
    const html = await rendered("OBJ-3");
    expect(html).not.toContain("Committed objective whose key results");
  });
});
