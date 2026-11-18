/**
 * An agent's instructions on Admin, Agents (docs/design/agent-instructions.md,
 * plan 0.7.0 A7).
 *
 * Acceptance:
 *   Given a person saves new instructions, then a new version exists with
 *   their name, and an older version can be restored.
 *   Given AI off, then "Plan a run" is not shown and the instructions can
 *   still be edited.
 *   Given the Coach, then its instructions are shown read-only.
 *
 * Makes its own custom agent over the API, so it relies on the claim alone.
 */
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

const STAMP = Date.now().toString(36);
const AGENT = `Onboarding helper ${STAMP}`;
const NEW_TEXT = "Each week, find key results below 0.4 and ask the owner what changed.";

let context: BrowserContext;
let page: Page;
let api: APIRequestContext;
let token = "";

test.beforeAll(async ({ browser, playwright, baseURL }) => {
  context = await browser.newContext();
  page = await context.newPage();
  api = await playwright.request.newContext({ baseURL });
});

test.afterAll(async () => {
  await api?.dispose();
  await context?.close();
});

/** Opens an agent's tab and returns its cards. */
const openAgent = async (name: string) => {
  await page.getByRole("tab", { name: new RegExp(name) }).click();
  return page.getByRole("tabpanel", { name: new RegExp(name) });
};

test("a custom agent, made over the API", async () => {
  await signIn(page);
  await goTo(page, "/account/api-tokens");
  await page.getByLabel("Name").fill("Agent instructions e2e");
  await page.getByRole("checkbox", { name: "Write" }).check();
  await page.getByRole("button", { name: "Create token" }).click();
  const shown = page.getByTestId("minted-token");
  await expect(shown).toBeVisible({ timeout: 10_000 });
  token = ((await shown.textContent()) ?? "").trim();

  const response = await api.post("/api/v1/agents/create", {
    headers: { authorization: `Bearer ${token}` },
    data: {
      name: AGENT,
      kind: "custom",
      persona: "",
      planningInstructions: "Draft a plan.",
      executionInstructions: "Keep the week moving.",
      provider: null,
      tier: null,
      schedule: "manual",
      autonomy: "propose",
    },
  });
  expect(response.status()).toBe(200);
});

test("acceptance: a saved version has a name, and an older one can be restored", async () => {
  await goTo(page, "/admin/agents");
  const panel = await openAgent(AGENT);
  const planning = panel.locator('[data-testid^="agent-stage-"]').filter({
    hasText: "While planning (phases 0 to 5)",
  });
  await planning
    .getByRole("textbox", { name: "While planning (phases 0 to 5)" })
    .fill(NEW_TEXT);
  await planning.getByRole("button", { name: "Save a new version" }).click();
  await expect(planning.getByText("Saved as version 1.")).toBeVisible({
    timeout: 15_000,
  });

  await goTo(page, "/admin/agents");
  const reopened = await openAgent(AGENT);
  const history = reopened.getByRole("list", {
    name: "Versions of While planning (phases 0 to 5)",
  });
  await expect(history).toContainText("Version 1, by");
  await history
    .getByRole("button", { name: "Restore version 0" })
    .click();
  await expect(
    reopened
      .getByRole("list", { name: "Versions of While planning (phases 0 to 5)" })
      .getByText(/^Version 2, by/),
  ).toBeVisible({ timeout: 15_000 });
});

test("acceptance: with AI off there is no Plan a run, and the Coach's instructions are read-only", async () => {
  await goTo(page, "/admin/agents");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("button", { name: "Plan a run" })).toHaveCount(0);

  const coach = await openAgent("OKR Coach");
  await expect(coach).toContainText("follows the method");
  await expect(
    coach.getByRole("button", { name: "Save a new version" }),
  ).toHaveCount(0);
});
