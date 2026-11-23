import { isValidElement, type ReactElement } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  type Minutes,
  minutesToMarkdown,
} from "../app/session/[id]/minutes/minutes-document";
import {
  renderMinutesPdf,
  renderMinutesPrintView,
} from "../app/session/[id]/minutes/pdf/render";

const pdf = vi.hoisted(() => ({
  renderToBuffer: vi.fn<(document: ReactElement) => Promise<Buffer>>(async () =>
    Buffer.from("%PDF"),
  ),
}));

vi.mock("@react-pdf/renderer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@react-pdf/renderer")>()),
  renderToBuffer: pdf.renderToBuffer,
}));

const minutes: Minutes = {
  title: "Quarterly review",
  heldOn: "2026-06-17",
  state: "closed",
  summary: {
    cycleScore: 0.75,
    committed: { met: 2, reviewed: 3 },
    verdict: "results_delivered",
    objectivesReviewed: 1_250,
    keyResultsReviewed: 4,
    belowThreshold: 0,
    teamPulse: 4.5,
    learningsCarried: 0,
    actionsAgreed: 0,
  },
  scores: [],
  narratives: [],
  recognition: [],
  retro: [],
  management: null,
  rootCauses: [],
  processHealth: [],
  decisions: [],
  learnings: [],
  drafts: [],
  actions: [],
};

function pageOf(document: ReactElement): ReactElement<{
  readonly style: { readonly direction?: string };
  readonly children: readonly ReactElement[];
}> {
  const props = document.props as { readonly children: unknown };
  if (!isValidElement(props.children)) {
    throw new Error("The PDF document has no page.");
  }
  return props.children as ReturnType<typeof pageOf>;
}

beforeEach(() => pdf.renderToBuffer.mockClear());

describe("minutes PDF localisation (languages §13, AC-28)", () => {
  test("uses server catalogue labels and the requester's dates and numbers", () => {
    const text = minutesToMarkdown(minutes, "ms");
    expect(text).toContain("## Ringkasan eksekutif");
    expect(text).toContain("17 Jun 2026");
    expect(text).toContain("1,250");
    expect(text).not.toContain("## Executive summary");
    expect(text).not.toContain("2026-06-17");
  });

  test("numbers pages in the requester's language", async () => {
    await renderMinutesPdf("# Quarterly review", "ms");
    const tree = pdf.renderToBuffer.mock.calls[0]?.[0];
    if (!tree) {
      throw new Error("The PDF was not rendered.");
    }
    const footer = pageOf(tree).props.children[1]?.props as {
      readonly render: (pages: {
        pageNumber: number;
        totalPages: number;
      }) => string;
    };
    expect(footer.render({ pageNumber: 2, totalPages: 5 })).toBe(
      "2 daripada 5",
    );
  });

  test("sets right-to-left direction for Arabic", async () => {
    await renderMinutesPdf("# محضر الاجتماع", "ar");
    const tree = pdf.renderToBuffer.mock.calls[0]?.[0];
    if (!tree) {
      throw new Error("The PDF was not rendered.");
    }
    expect(pageOf(tree).props.style.direction).toBe("rtl");
  });

  test("the Arabic print view renders text with the local font and escapes minutes content", () => {
    const html = renderMinutesPrintView({
      markdown: "# زيادة زيت الثالث\n\n- <script>unexpected</script>",
      title: "Quarterly <review>",
      locale: "ar",
      nonce: "request-nonce",
    });
    expect(html).toContain('<html lang="ar" dir="rtl">');
    expect(html).toContain("/fonts/noto-sans-arabic/fonts.css");
    expect(html).toContain("زيادة زيت الثالث");
    expect(html).toContain("&lt;script&gt;unexpected&lt;/script&gt;");
    expect(html).toContain('<script nonce="request-nonce">');
  });
});
