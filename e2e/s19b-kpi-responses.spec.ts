/**
 * Three responses to an unhealthy KPI (P9-T18b, METHOD.md §6.5, §6.6).
 *
 * Acceptance:
 *   Given an unhealthy KPI, when "fix it now" is chosen, then a task with an
 *   owner and a date exists and no recovery OKR was drafted.
 *
 * And the second response from the same board: a key result for another
 * unhealthy KPI on an objective that already exists, then a third KPI answered
 * by naming that same key result rather than writing another (NW-Q3-04). Each
 * card then shows its answer rather than offering the three again.
 *
 * KPIs cannot be deleted, so the three stay, with stamped titles, one unhealthy
 * month each, which is short of the two a recovery proposal waits for. The
 * task and the objective this made are deleted afterwards, which closes both
 * answers, so a later run sees the cards asking again.
 */
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

const STAMP = Date.now().toString(36);
const FIX_KPI = `Cost to serve ${STAMP}`;
const KR_KPI = `Gross margin ${STAMP}`;
const NAMED_KPI = `Expansion seats ${STAMP}`;
const OBJECTIVE = `Run on sound unit economics ${STAMP}`;

let context: BrowserContext;
let page: Page;
let api: APIRequestContext;
let token = "";
let fixKpiId = "";
let krKpiId = "";
let namedKpiId = "";
let objectiveId = "";
let taskId = "";

const authed = () => ({ authorization: `Bearer ${token}` });

async function post<T>(action: string, data: unknown): Promise<T> {
  const response = await api.post(`/api/v1/${action.replace(".", "/")}`, {
    headers: authed(),
    data,
  });
  expect(response.status(), `${action}: ${await response.text()}`).toBe(200);
  return (await response.json()).data as T;
}

async function get<T>(path: string): Promise<T> {
  const response = await api.get(`/api/v1/${path}`, { headers: authed() });
  expect(response.status(), `${path}: ${await response.text()}`).toBe(200);
  return (await response.json()).data as T;
}

interface Card {
  kpiId: string;
  recovery: unknown;
  response: {
    kind: string;
    subjectId: string | null;
    title: string | null;
    dueOn: string | null;
    goalId: string | null;
    open: boolean;
  } | null;
}

const boardCard = async (kpiId: string) =>
  (await get<{ cards: Card[] }>("kpis/recoveryBoard")).cards.find(
    (card) => card.kpiId === kpiId,
  );

/** Sixty of a hundred this month, below the seventy percent watch floor. */
async function unhealthyKpi(title: string): Promise<string> {
  const kpi = await post<{ id: string }>("kpis.create", {
    title,
    frequency: "monthly",
    targetDefault: 100,
  });
  const recorded = await post<{ state: string }>("kpis.record", {
    kpiId: kpi.id,
    on: new Date().toISOString().slice(0, 10),
    actualValue: 60,
  });
  expect(recorded.state).toBe("unhealthy");
  return kpi.id;
}

test.beforeAll(async ({ browser, playwright, baseURL }) => {
  context = await browser.newContext();
  page = await context.newPage();
  api = await playwright.request.newContext({ baseURL });
});

test.afterAll(async () => {
  if (token && taskId) {
    await api.post("/api/v1/tasks/delete", {
      headers: authed(),
      data: { id: taskId },
    });
  }
  if (token && objectiveId) {
    await api.post("/api/v1/goals/delete", {
      headers: authed(),
      data: { id: objectiveId },
    });
  }
  await api?.dispose();
  await context?.close();
});

test("sign in, with three unhealthy KPIs and an objective that exists", async () => {
  await signIn(page);
  await goTo(page, "/account/api-tokens");
  await page.getByLabel("Name").fill("KPI responses e2e");
  await page.getByRole("checkbox", { name: "Write" }).check();
  await page.getByRole("checkbox", { name: "Destructive" }).check();
  await page.getByRole("button", { name: "Create token" }).click();
  const shown = page.getByTestId("minted-token");
  await expect(shown).toBeVisible({ timeout: 10_000 });
  token = ((await shown.textContent()) ?? "").trim();

  fixKpiId = await unhealthyKpi(FIX_KPI);
  krKpiId = await unhealthyKpi(KR_KPI);
  namedKpiId = await unhealthyKpi(NAMED_KPI);
  const cycle = await get<{ id: string }>("cycles/current?mode=quarterly");
  objectiveId = (
    await post<{ id: string }>("goals.create", {
      title: OBJECTIVE,
      cycleId: cycle.id,
      level: "team",
      ownerKind: "workspace",
    })
  ).id;
});

test("acceptance: fixing it now is a task with an owner and a date, and no recovery", async () => {
  await goTo(page, "/kpis/recovery");
  const card = page.locator(`#kpi-${fixKpiId}`);
  await expect(card.getByTestId("kpi-responses")).toBeVisible({
    timeout: 15_000,
  });
  await card.getByText("Fix it now", { exact: true }).click();
  await card.getByLabel("Due").fill("2030-01-15");
  await card.getByRole("button", { name: "Create the task" }).click();

  // The card shows the answer instead of the three.
  const answer = card.getByTestId("kpi-response");
  await expect(answer).toContainText("Being fixed now", { timeout: 15_000 });
  await expect(answer).toContainText(`Fix ${FIX_KPI}`);
  await expect(card.getByTestId("kpi-responses")).toHaveCount(0);

  const read = await boardCard(fixKpiId);
  expect(read?.recovery).toBeNull();
  expect(read?.response).toMatchObject({
    kind: "fix_now",
    title: `Fix ${FIX_KPI}`,
    dueOn: "2030-01-15",
    open: true,
  });
  taskId = read?.response?.subjectId as string;
  const task = await get<{ dueOn: string; assignees: unknown[] }>(
    `tasks/read?id=${taskId}`,
  );
  expect(task.dueOn).toBe("2030-01-15");
  expect(task.assignees).toHaveLength(1);
});

test("adds a key result for the other KPI to an objective that exists", async () => {
  await goTo(page, "/kpis/recovery");
  const card = page.locator(`#kpi-${krKpiId}`);
  await expect(card.getByTestId("kpi-responses")).toBeVisible({
    timeout: 15_000,
  });
  await card.getByText("Add a key result", { exact: true }).click();
  await card.getByLabel("Objective").selectOption({ label: OBJECTIVE });
  // Mid-cycle, a key result may be asked why it starts now.
  await card.getByLabel("Why now").fill("Margin fell this month");
  await card.getByRole("button", { name: "Add the key result" }).click();

  const answer = card.getByTestId("kpi-response");
  await expect(answer).toContainText("Answered by a key result", {
    timeout: 15_000,
  });
  await expect(answer).toContainText(OBJECTIVE);

  const read = await boardCard(krKpiId);
  expect(read?.recovery).toBeNull();
  expect(read?.response).toMatchObject({
    kind: "key_result",
    goalId: objectiveId,
    open: true,
  });
});

test("names a key result that already exists as another KPI's answer", async () => {
  await goTo(page, "/kpis/recovery");
  const card = page.locator(`#kpi-${namedKpiId}`);
  await expect(card.getByTestId("kpi-responses")).toBeVisible({
    timeout: 15_000,
  });
  await card.getByText("Add a key result", { exact: true }).click();
  const existing = card.getByLabel("Or one that already exists");
  const keyResultId = await existing
    .locator("option")
    .filter({ hasText: KR_KPI })
    .first()
    .getAttribute("value");
  await existing.selectOption(keyResultId as string);
  await card.getByRole("button", { name: "That one answers it" }).click();

  await expect(card.getByTestId("kpi-response")).toContainText(
    "Answered by a key result",
    { timeout: 15_000 },
  );
  expect((await boardCard(namedKpiId))?.response).toMatchObject({
    kind: "key_result",
    subjectId: keyResultId,
    goalId: objectiveId,
    open: true,
  });
});
