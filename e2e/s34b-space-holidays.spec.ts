/**
 * A space's holidays (P9-T19b-a, METHOD.md §7.4).
 *
 * Acceptance:
 *   Given a space with the week of 9 August marked as a holiday, when no
 *   check-in is published that week, then the streak continues and no nudge
 *   is sent.
 *
 * The streak and the nudge are proved against the rules themselves in
 * `packages/method` and `packages/core`; what only a browser can show is the
 * screen that marks the week, and that marking it moves what is due. The
 * space is this spec's own, so the summer it marks reaches no other spec, and
 * it is archived afterwards with the objective deleted.
 */
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { connectionOptions, testDbEnv } from "@openokr/test-support/db";
import pg from "pg";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

const CONNECTION = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : connectionOptions(
      process.env.E2E_DATABASE ?? "openokr_e2e",
      testDbEnv.superuser,
    );

test.describe.configure({ mode: "serial" });

const STAMP = Date.now().toString(36);
const SPACE = `Product Europe ${STAMP}`;
const OBJECTIVE = `Every release reaches the field the same week ${STAMP}`;

let context: BrowserContext;
let page: Page;
let api: APIRequestContext;
let pool: pg.Pool;
let token = "";
let spaceId = "";
let goalId = "";
/** The goal's first due date, as the cadence stamped it. */
let dueOn = "";

const authed = () => ({ authorization: `Bearer ${token}` });

async function post<T>(action: string, data: unknown): Promise<T> {
  const response = await api.post(`/api/v1/${action.replace(".", "/")}`, {
    headers: authed(),
    data,
  });
  expect(response.status(), `${action}: ${await response.text()}`).toBe(200);
  return (await response.json()).data as T;
}

const addDays = (on: string, days: number): string =>
  new Date(Date.parse(`${on}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);

async function nextDue(): Promise<string> {
  const { rows } = await pool.query<{ next: string }>(
    `select (g.next_check_in_at at time zone
              coalesce(nullif(w.settings->>'timezone', ''), 'UTC'))::date::text as next
       from goals g join workspaces w on w.id = g.workspace_id
      where g.id = $1`,
    [goalId],
  );
  return rows[0]?.next as string;
}

test.beforeAll(async ({ browser, playwright, baseURL }) => {
  pool = new pg.Pool(CONNECTION);
  context = await browser.newContext();
  page = await context.newPage();
  api = await playwright.request.newContext({ baseURL });
});

test.afterAll(async () => {
  if (token) {
    if (goalId) {
      await api.post("/api/v1/goals/delete", {
        headers: authed(),
        data: { id: goalId },
      });
    }
    if (spaceId) {
      await api.post("/api/v1/spaces/setHolidays", {
        headers: authed(),
        data: { id: spaceId, holidays: [] },
      });
      await api.post("/api/v1/spaces/archive", {
        headers: authed(),
        data: { id: spaceId },
      });
    }
  }
  await api?.dispose();
  await pool?.end();
  await context?.close();
});

test("sign in, with a space of its own and an objective due in it", async () => {
  await signIn(page);
  await goTo(page, "/account/api-tokens");
  await page.getByLabel("Name").fill("Space holidays e2e");
  await page.getByRole("checkbox", { name: "Write" }).check();
  await page.getByRole("checkbox", { name: "Destructive" }).check();
  await page.getByRole("button", { name: "Create token" }).click();
  const shown = page.getByTestId("minted-token");
  await expect(shown).toBeVisible({ timeout: 10_000 });
  token = ((await shown.textContent()) ?? "").trim();

  spaceId = (await post<{ id: string }>("spaces.create", { name: SPACE })).id;
  const cycle = (
    await (
      await api.get("/api/v1/cycles/current?mode=quarterly", {
        headers: authed(),
      })
    ).json()
  ).data as { id: string };
  goalId = (
    await post<{ id: string }>("goals.create", {
      title: OBJECTIVE,
      cycleId: cycle.id,
      spaceId,
      level: "team",
      ownerKind: "space",
    })
  ).id;
  dueOn = await nextDue();
  expect(dueOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

test("acceptance: marking the week it is due in moves the check-in past it", async () => {
  await goTo(page, `/spaces/${spaceId}`);
  const card = page.getByTestId("space-holidays");
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card).toContainText("No holidays marked.");

  // Nothing ends before it starts, and the end says so under itself.
  await card.getByLabel("From").fill(addDays(dueOn, 3));
  await card.getByLabel("To").fill(dueOn);
  await expect(
    card.getByRole("button", { name: "Mark the holiday" }),
  ).toBeDisabled();
  await expect(card.getByRole("alert")).toHaveText(
    `Ends before it starts. Pick a date on or after ${addDays(dueOn, 3)}.`,
  );

  // The whole week the check-in is due in, Monday to Sunday.
  const day = new Date(`${dueOn}T00:00:00Z`).getUTCDay();
  const monday = addDays(dueOn, day === 0 ? -6 : 1 - day);
  await card.getByLabel("From").fill(monday);
  await card.getByLabel("To").fill(addDays(monday, 6));
  await card.getByLabel("What it is (optional)").fill("Summer");
  await card.getByRole("button", { name: "Mark the holiday" }).click();

  await expect(card.getByTestId("space-holidays-saved")).toBeVisible({
    timeout: 15_000,
  });
  await expect(card).toContainText(`${monday} to ${addDays(monday, 6)}`);
  await expect(card).toContainText("Summer");

  // No check-in is due in it: the goal is due a period on, the same weekday.
  expect(await nextDue()).toBe(addDays(dueOn, 7));

  // And the mark survives a reload, read back from the space.
  await page.reload();
  await expect(page.getByTestId("space-holidays")).toContainText("Summer", {
    timeout: 15_000,
  });
});

test("taking the holiday off leaves it gone", async () => {
  const card = page.getByTestId("space-holidays");
  await card.getByRole("button", { name: /Remove the holiday from/ }).click();
  await expect(card).toContainText("No holidays marked.", { timeout: 15_000 });
});
