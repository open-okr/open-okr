import { CATALOGUES, translate } from "@openokr/ui";
import type { ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Plan 0.8.0 L2: an empty Work Map's one next step was a link at the end of a
// small grey sentence, and it was drawn for readers who cannot draft.

vi.mock("../lib/translations", () => ({
  getTranslations: async () => ({
    t: (key: string, values?: Record<string, string | number>) =>
      translate(CATALOGUES.en, key, values),
  }),
}));
vi.mock("../lib/ceilings.ts", () => ({ progressCeiling: async () => 1 }));
vi.mock("../lib/confidence-display.ts", () => ({
  confidenceDisplay: async () => "band",
}));
vi.mock("../lib/terminology.ts", async () => {
  const { resolveTerminology } = await import("@openokr/method");
  return { workspaceTerminology: async () => resolveTerminology() };
});
vi.mock("../app/quick-check-in.tsx", () => ({ QuickCheckIn: () => null }));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { WorkMap } = await import("../app/work-map");

// The goal table inside is an async server component, so the page is
// streamed to the end rather than rendered in one synchronous pass.
const render = async (canEdit: boolean) => {
  const element = (await WorkMap({
    nodes: [],
    selected: null,
    canEdit,
    hrefFor: () => "/map",
  })) as ReactNode;
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return new Response(stream).text();
};

describe("an empty Work Map", () => {
  it("offers Start drafting as a primary button to a reader who can draft", async () => {
    const html = await render(true);
    expect(html).toContain('data-testid="start-drafting"');
    expect(html).toContain('href="/cycle?phase=4"');
    expect(html).toContain("Start drafting");
  });

  it("explains, and offers nothing, to a reader who cannot draft", async () => {
    const html = await render(false);
    expect(html).toContain("Objectives are drafted in phase 4");
    expect(html).not.toContain('data-testid="start-drafting"');
    expect(html).not.toContain("Start drafting");
  });
});
