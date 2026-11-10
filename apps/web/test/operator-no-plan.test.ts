import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CATALOGUES, translate } from "@openokr/ui";
import { describe, expect, test } from "vitest";

/**
 * What the console says about a workspace with no plan (plan 0.8.0 O2,
 * docs/design/workspaces-without-a-plan.md §2). The run itself is proved
 * against a real database in `packages/core/test/default-plan-fill.test.ts`,
 * and the screens end to end in `e2e/s45-operator-console.spec.ts`. What is
 * checked here is the rule each screen draws on.
 */

const at = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const list = at("../app/operator/page.tsx");
const detail = at("../app/operator/[workspaceId]/page.tsx");
const review = at("../app/operator/default-plan/page.tsx");

describe("a workspace with no plan, on the console", () => {
  test("is marked only when the instance has a catalogue", () => {
    // With an empty catalogue the provider's key is open to every workspace
    // (ai-credits.md §3), so there is nothing to warn about.
    expect(list).toContain("const noPlanCostsAI = plans.length > 0;");
    expect(list).toContain("tenant.planKey === null && noPlanCostsAI ? (");
    expect(detail).toContain("tenant.planKey === null && plans.length > 0 ? (");
  });

  test("leaves closed and erasing workspaces out of the count", () => {
    expect(list).toContain('one.tenantState !== "closed"');
    expect(list).toContain("one.erasingAt === null");
  });

  test("offers the review only when a default plan is set", () => {
    expect(list).toContain("{defaultPlan ? (");
    expect(list).toContain('href="/operator/default-plan"');
  });

  test("the review says a plan with no AI credits gives no AI back, before the list", () => {
    expect(review.indexOf("default-plan-no-credits")).toBeLessThan(
      review.indexOf("default-plan-will-move"),
    );
    expect(
      translate(CATALOGUES.en, "operator.defaultPlan.noCredits", {
        plan: "Free",
      }),
    ).toBe(
      "Free includes no AI credits, so moving these workspaces sets a seat limit and does not give them AI.",
    );
  });
});
