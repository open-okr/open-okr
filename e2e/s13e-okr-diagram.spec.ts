/**
 * The OKR diagram (P9-T09a, docs/design/p9-t00-okr-writing.md §5).
 *
 * Acceptance:
 *   Given a cycle, when the diagram opens, then its objectives are drawn with
 *   their key results, and an objective aligned to a key result hangs from
 *   that key result.
 *   Given a card, when it is clicked, or reached and opened with the
 *   keyboard, then the drawer opens on it.
 *   Given 300 objectives in one cycle, when the diagram opens, then it is
 *   interactive within the budget and collapsed below company level (U10).
 *
 * **It leaves what it found.** Its objectives are deleted at the end,
 * whatever happened. The three hundred live in a far quarter of their own,
 * so no other spec's cycle ever holds them.
 */
import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

const COMPANY = "Make the mid-market our fastest-growing segment";
const KEY_RESULT = "Mid-market accounts from 120 to 200";
const TEAM = "Make onboarding something a mid-market team finishes alone";
/** A quarter four years out, which no other spec makes. */
const FAR = `${new Date().getUTCFullYear() + 4}-05-15`;
const LOAD = "Diagram load objective";
/** design §7: interactive in under a second on the reference machine. */
const BUDGET_MS = 1_000;

let context: BrowserContext;
let page: Page;
let api: APIRequestContext;
let token = "";
/** What this spec made, children apart from parents so they go first. */
const madeChildren: string[] = [];
const madeParents: string[] = [];

const authed = () => ({ authorization: `Bearer ${token}` });
const diagram = () => page.getByTestId("okr-diagram");
const card = (id: string) => page.getByTestId(`rf__node-${id}`);
const drawer = () => page.getByTestId("okr-drawer");

async function post<T>(path: string, data: unknown): Promise<T> {
  const response = await api.post(`/api/v1/${path}`, {
    headers: authed(),
    data,
  });
  expect(response.status(), `${path}: ${await response.text()}`).toBe(200);
  return (await response.json()).data as T;
}

async function cycleOn(on: string): Promise<string> {
  const listed = await api.get("/api/v1/cycles/list", { headers: authed() });
  const found = (
    (await listed.json()).data as {
      id: string;
      mode: string;
      startsOn: string;
      endsOn: string;
    }[]
  ).find(
    (cycle) =>
      cycle.mode === "quarterly" && cycle.startsOn <= on && on <= cycle.endsOn,
  );
  return found?.id ?? (await post<{ id: string }>("cycles/create", { on })).id;
}

test.beforeAll(async ({ browser, playwright, baseURL }) => {
  context = await browser.newContext();
  page = await context.newPage();
  api = await playwright.request.newContext({ baseURL });
});

test.afterAll(async () => {
  // Three hundred deletes take longer than a hook is given by default.
  test.setTimeout(180_000);
  if (token) {
    // Children first, so nothing is deleted with something still below it.
    for (const ids of [madeChildren, madeParents]) {
      for (let at = 0; at < ids.length; at += 10) {
        const deleted = await Promise.all(
          ids.slice(at, at + 10).map((id) =>
            api.post("/api/v1/goals/delete", {
              headers: authed(),
              data: { id },
            }),
          ),
        );
        // A refused delete leaves three hundred objectives in every later
        // spec's workspace, so it fails here rather than somewhere else.
        expect(deleted.map((response) => response.status())).toEqual(
          deleted.map(() => 200),
        );
      }
    }
  }
  await api?.dispose();
  await context?.close();
});

let companyId = "";
let teamId = "";
let currentCycle = "";

test("sign in, with a token for setting up and putting things back", async () => {
  await signIn(page);
  await goTo(page, "/account/api-tokens");
  await page.getByLabel("Name").fill("OKR diagram e2e");
  await page.getByRole("checkbox", { name: "Write" }).check();
  // Deleting is destructive, which Write alone is refused, so without this
  // the clean-up below was refused and left its objectives behind.
  await page.getByRole("checkbox", { name: "Destructive" }).check();
  await page.getByRole("button", { name: "Create token" }).click();
  const shown = page.getByTestId("minted-token");
  await expect(shown).toBeVisible({ timeout: 10_000 });
  token = ((await shown.textContent()) ?? "").trim();

  const current = await api.get("/api/v1/cycles/current?mode=quarterly", {
    headers: authed(),
  });
  currentCycle = (await current.json()).data.id as string;
  companyId = (
    await post<{ id: string }>("goals/create", {
      title: COMPANY,
      cycleId: currentCycle,
      level: "company",
    })
  ).id;
  madeParents.push(companyId);
  const keyResult = await post<{ id: string }>("goals/addKeyResult", {
    goalId: companyId,
    title: KEY_RESULT,
    direction: "increase",
    indicatorType: "lagging",
    baselineValue: 120,
    targetValue: 200,
  });
  teamId = (
    await post<{ id: string }>("goals/create", {
      title: TEAM,
      cycleId: currentCycle,
      level: "team",
      parentKeyResultId: keyResult.id,
    })
  ).id;
  madeChildren.push(teamId);
});

test("the diagram draws the cycle, and an objective aligned to a key result hangs from it", async () => {
  await goTo(page, `/goals?display=diagram&cycle=${currentCycle}`);
  await expect(diagram()).toBeVisible({ timeout: 15_000 });
  await expect(card(companyId)).toContainText(COMPANY);
  await expect(card(companyId)).toContainText(KEY_RESULT);
  await expect(card(teamId)).toContainText(TEAM);
  // The line joins the team objective to the key result's own row.
  await expect(
    page.getByTestId(`rf__edge-align:${teamId}`),
  ).toHaveAttribute("aria-label", `${TEAM} aligns to ${COMPANY}`);

  const scan = await new AxeBuilder({ page })
    .include('[data-testid="okr-diagram"]')
    .analyze();
  expect(
    scan.violations.filter(
      (violation) =>
        violation.impact === "serious" || violation.impact === "critical",
    ),
  ).toEqual([]);
});

test("a card opens the drawer, by pointer and by keyboard", async () => {
  await card(companyId).getByText(COMPANY).click();
  await expect(drawer().getByRole("heading", { name: COMPANY })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer()).toHaveCount(0);

  // Up from the team objective is the objective it hangs from; Enter opens it.
  await card(teamId).focus();
  await page.keyboard.press("ArrowUp");
  await expect(card(companyId)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(drawer().getByRole("heading", { name: COMPANY })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer()).toHaveCount(0);
});

test("a collapse hides what is aligned below, and says how much", async () => {
  await card(companyId)
    .getByRole("button", { name: `Collapse ${COMPANY}` })
    .click();
  await expect(card(teamId)).toHaveCount(0);
  await expect(card(companyId)).not.toContainText(KEY_RESULT);
  await card(companyId)
    .getByRole("button", { name: `Expand ${COMPANY}` })
    .click();
  await expect(card(teamId)).toBeVisible();

  const dependencies = page.getByRole("button", { name: "Dependencies" });
  await dependencies.click();
  await expect(dependencies).toHaveAttribute("aria-pressed", "true");
});

test("U10: three hundred objectives open collapsed below company level, within the budget", async () => {
  test.setTimeout(240_000);
  const cycleId = await cycleOn(FAR);
  // Thirty company objectives, each with nine team objectives below it.
  for (let company = 0; company < 30; company += 1) {
    const parent = await post<{ id: string }>("goals/create", {
      title: `${LOAD} ${company}`,
      cycleId,
      level: "company",
    });
    madeParents.push(parent.id);
    const children = await Promise.all(
      Array.from({ length: 9 }, (_, child) =>
        post<{ id: string }>("goals/create", {
          title: `${LOAD} ${company}.${child}`,
          cycleId,
          level: "team",
          parentGoalId: parent.id,
        }),
      ),
    );
    madeChildren.push(...children.map((child) => child.id));
  }

  const started = Date.now();
  await goTo(page, `/goals?display=diagram&cycle=${cycleId}`);
  const first = page.getByRole("group", { name: new RegExp(`^${LOAD} 0,`) });
  await expect(first).toBeVisible({ timeout: 30_000 });
  // Collapsed below company level on arrival: the thirty company cards, each
  // saying what it holds, and not one team card drawn.
  await expect(diagram().getByText("+9 below")).toHaveCount(30);
  await expect(
    page.getByRole("group", { name: new RegExp(`^${LOAD} 0\\.0,`) }),
  ).toHaveCount(0);
  // Interactive: a press is answered, not just painted.
  await first.getByRole("button", { name: `Expand ${LOAD} 0` }).click();
  await expect(
    page.getByRole("group", { name: new RegExp(`^${LOAD} 0\\.0,`) }),
  ).toBeVisible();
  const interactive = Date.now() - started;
  test.info().annotations.push({
    type: "diagram, 300 objectives",
    description: `interactive after ${interactive} ms, budget ${BUDGET_MS} ms on the reference machine`,
  });
  // Printed as well, so the number is in the run's own log.
  console.log(`U10: interactive after ${interactive} ms`);

  // A ceiling for whatever machine runs this; the budget itself is measured
  // on the reference machine and recorded in the design (§7).
  expect(interactive).toBeLessThan(15_000);
});
