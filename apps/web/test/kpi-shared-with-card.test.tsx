import { TranslationsProvider } from "@openokr/ui";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { SharedWithCard } from "../app/kpis/[id]/shared-with-card.tsx";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined }),
}));

const inEnglish = (node: ReactNode) =>
  renderToStaticMarkup(
    <TranslationsProvider locale="en">{node}</TranslationsProvider>,
  );

describe("SharedWithCard (0.10.0 K7 S-21)", () => {
  const kpiId = "00000000-0000-4000-8000-000000000001";

  test("loading state renders a card skeleton", () => {
    const html = inEnglish(
      <SharedWithCard kpiId={kpiId} canFull={true} loading={true} />,
    );
    expect(html).toContain('data-testid="shared-with-skeleton"');
  });

  test("empty state renders 'Not shared with anyone. Members read it through their role.'", () => {
    const html = inEnglish(
      <SharedWithCard
        kpiId={kpiId}
        canFull={true}
        owner={{ memberId: "m1", name: "Alice", kind: "human" }}
        shares={[]}
      />,
    );
    expect(html).toContain(
      "Not shared with anyone. Members read it through their role.",
    );
  });

  test("error state renders card with error text and Retry button", () => {
    const html = inEnglish(
      <SharedWithCard
        kpiId={kpiId}
        canFull={true}
        error="Could not load who this KPI is shared with."
        onRetry={() => undefined}
      />,
    );
    expect(html).toContain("Could not load who this KPI is shared with.");
    expect(html).toContain("Retry");
  });

  test("read-only without full access lists owner and shares without controls", () => {
    const html = inEnglish(
      <SharedWithCard
        kpiId={kpiId}
        canFull={false}
        owner={{ memberId: "m1", name: "Alice", kind: "human" }}
        shares={[
          {
            memberId: "m2",
            name: "Bob",
            kind: "human",
            status: "active",
            level: "view",
            sharedAt: "2026-11-19T00:00:00.000Z",
            roleLevel: 10,
          },
        ]}
      />,
    );
    expect(html).toContain("Alice");
    expect(html).toContain("Bob");
    expect(html).toContain("View");
    // No share action button, no level select, no remove button
    expect(html).not.toContain('data-testid="open-share-panel"');
    expect(html).not.toContain('data-testid="share-level-select"');
    expect(html).not.toContain('data-testid="remove-share"');
  });

  test("renders 'Already has edit through their role' hint when role covers edit", () => {
    const html = inEnglish(
      <SharedWithCard
        kpiId={kpiId}
        canFull={true}
        owner={{ memberId: "m1", name: "Alice", kind: "human" }}
        shares={[
          {
            memberId: "m2",
            name: "Bob",
            kind: "human",
            status: "active",
            level: "edit",
            sharedAt: "2026-11-19T00:00:00.000Z",
            roleLevel: 70, // Member role covers edit
          },
        ]}
      />,
    );
    expect(html).toContain("Already has edit through their role");
  });
});
