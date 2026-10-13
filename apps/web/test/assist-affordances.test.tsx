import { TranslationsProvider } from "@openokr/ui";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

/**
 * The assist affordances, rendered (completeness review M-09).
 *
 * Rendered for real on the server renderer, because what matters is the
 * markup a member receives: the button each assist offers, and, as much, the
 * button it does not offer. The server actions are replaced, since rendering
 * reaches none of them, and whether a screen mounts the affordance at all is
 * `assistOffered`'s answer, proved in `assists-offered.test.ts`.
 *
 * **Every one of these renders nothing that writes.** The draft-bearing ones
 * (the retrospective, the decomposition, the KPI suggestion and the minutes
 * write-up) show a button that asks for a draft,
 * and the draft, once it arrives, sits in fields the person edits before any
 * save. That second state needs a click, which a server render cannot make,
 * so it is covered by the component code and the end-to-end suite.
 */

vi.mock("../app/kpis/[id]/actions.ts", () => ({
  narrateTrendAction: vi.fn(),
  setFormula: vi.fn(),
}));
vi.mock("../app/kpis/actions.ts", () => ({
  suggestKpiAction: vi.fn(),
  addSuggestedKpiAction: vi.fn(),
}));
vi.mock("../app/spaces/[id]/assist-actions.ts", () => ({
  summariseBlockersAction: vi.fn(),
}));
vi.mock("../app/goals/[id]/assist-actions.ts", () => ({
  draftRetrospectiveAction: vi.fn(),
  summariseThreadAction: vi.fn(),
  decomposeKeyResultAction: vi.fn(),
  createDecomposedWorkAction: vi.fn(),
}));
vi.mock("../app/session/[id]/actions.ts", () => ({
  addActionAction: vi.fn(),
  captureLearningAction: vi.fn(),
  completeActionAction: vi.fn(),
  draftMinutesAction: vi.fn(),
  saveMinutesWriteUpAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined }),
}));

const { TrendNarration } = await import("../app/kpis/[id]/trend-narration.tsx");
const { KpiSuggestion } = await import("../app/kpis/kpi-suggestion.tsx");
const { BlockerSummary } = await import(
  "../app/spaces/[id]/blocker-summary.tsx"
);
const { RetrospectiveField } = await import(
  "../app/goals/[id]/retrospective-field.tsx"
);
const { ThreadSummary } = await import("../app/goals/[id]/thread-summary.tsx");
const { DecomposeKeyResult } = await import("../app/goals/[id]/decompose.tsx");
const { ForwardPanel } = await import("../app/session/[id]/forward.tsx");
const { MinutesWriteUp } = await import(
  "../app/session/[id]/minutes/minutes-write-up.tsx"
);

const render = (node: ReactNode) =>
  renderToStaticMarkup(
    <TranslationsProvider locale="en">{node}</TranslationsProvider>,
  );

const ID = "11111111-1111-4111-8111-111111111111";

describe("the reading assists", () => {
  test("the trend narration offers to narrate and shows nothing else yet", () => {
    const html = render(<TrendNarration kpiId={ID} />);
    expect(html).toContain("Narrate the trend");
    expect(html).toContain('data-testid="trend-narration"');
    // No reading until somebody asks for one.
    expect(html).not.toContain("What stood out");
  });

  test("the blocker summary offers to summarise", () => {
    expect(render(<BlockerSummary spaceId={ID} />)).toContain(
      "Summarise the blockers",
    );
  });

  test("the thread summary offers to summarise the discussion", () => {
    expect(render(<ThreadSummary goalId={ID} />)).toContain(
      "Summarise the discussion",
    );
  });
});

describe("the close form's retrospective", () => {
  // The compact editor (guided-inputs §4.7), which the server renders empty
  // and the browser fills. Nothing is posted until something is written, and
  // the close action refuses that in words.
  test("is the labelled field with the assist not offered", () => {
    const html = render(<RetrospectiveField goalId={ID} offered={false} />);
    expect(html).toContain("The retrospective</legend>");
    expect(html).not.toContain('name="retrospective"');
    expect(html).not.toContain("Draft from the check-ins");
    expect(html).not.toContain('data-testid="retrospective-draft"');
  });

  test("offers a draft beside the same field when a provider may write one", () => {
    const html = render(<RetrospectiveField goalId={ID} offered />);
    expect(html).toContain("The retrospective</legend>");
    expect(html).toContain("Draft from the check-ins");
    // The field starts empty: a draft only reaches it when somebody chooses.
    expect(html).not.toContain('name="retrospective"');
  });
});

describe("decomposing a key result", () => {
  test("offers to draft the work, naming the key result", () => {
    const html = render(
      <DecomposeKeyResult
        goalId={ID}
        keyResultId={ID}
        keyResultTitle="Trial to paid from 18% to 30%"
        spaces={[{ id: ID, name: "Growth" }]}
        defaultSpaceId={ID}
      />,
    );
    expect(html).toContain("Draft the work");
    expect(html).toContain(
      'aria-label="Draft the work for Trial to paid from 18% to 30%"',
    );
    expect(html).not.toContain("Create what is ticked");
  });

  test("is not drawn for a reader with no space to put work in", () => {
    const html = render(
      <DecomposeKeyResult
        goalId={ID}
        keyResultId={ID}
        keyResultTitle="Anything"
        spaces={[]}
        defaultSpaceId={null}
      />,
    );
    expect(html).toBe("");
  });
});

describe("the KPI suggestion", () => {
  test("asks for a sentence and offers nothing to add until it has one", () => {
    const html = render(<KpiSuggestion />);
    expect(html).toContain("Or describe it in a sentence");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>.*Suggest the fields/);
    expect(html).not.toContain("Add it");
  });
});

describe("the minutes write-up", () => {
  test("offers a draft, and saves nothing on its own", () => {
    const html = render(<MinutesWriteUp sessionId={ID} title="Q3 review" />);
    expect(html).toContain("Draft a write-up");
    expect(html).not.toContain("Save as a draft document");
  });
});

describe("the learnings stage drafts nothing for the next cycle (P9-T22d)", () => {
  const forward = (
    drafts: readonly { id: string; title: string; why: string }[] = [],
  ) => ({
    learnings: [
      {
        id: ID,
        text: "Billing needs a week's notice",
        carryForward: true,
        source: "manual",
        authorName: "Priya",
      },
    ],
    promotable: [],
    drafts: drafts.map((draft) => ({ ...draft, promoted: false })),
    actions: [],
    owners: [],
    carried: 1,
  });

  test("offers no draft form and no proposal, and says where an idea goes", () => {
    // METHOD.md §8.10: hold the review before drafting. A kept objective
    // reaches the next cycle's Phase 4 on its own, and an idea reaches its
    // issue list as a carried learning.
    const html = render(
      <ForwardPanel sessionId={ID} forward={forward()} canEdit />,
    );
    expect(html).not.toContain("Draft it");
    expect(html).not.toContain("Propose drafts from the carried learnings");
    expect(html).toContain("An idea for the next cycle?");
  });

  test("still shows a draft written before, read-only, as part of the record", () => {
    const html = render(
      <ForwardPanel
        sessionId={ID}
        forward={forward([
          {
            id: ID,
            title: "Make onboarding something a team finishes in one sitting",
            why: "Three of five losses were onboarding.",
          },
        ])}
        canEdit
      />,
    );
    expect(html).toContain(
      "Make onboarding something a team finishes in one sitting",
    );
    expect(html).toContain("before it became Learnings");
    expect(html).not.toContain("Draft it");
  });
});
