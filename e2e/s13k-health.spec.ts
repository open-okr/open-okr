/**
 * Health that says what happened (P9-T15b-a, METHOD.md §3.5).
 *
 * Acceptance:
 *   Given an objective stopped mid-cycle, then its health reads abandoned,
 *   not missed. Given a goal whose check-in is overdue past grace after an
 *   on-track check-in, then it reads outdated with "on track" beside it.
 *
 * The outdated state is written directly, as the staleness sweep writes it,
 * because the sweep runs on the scheduler's clock and a spec cannot wait for
 * a grace window to pass.
 */
import { connectionOptions, testDbEnv } from "@openokr/test-support/db";
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import pg from "pg";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

const STAMP = Date.now().toString(36);
const QUIET = `Make onboarding self-serve ${STAMP}`;
const STOPPED = `Expansion comes from accounts that reached value ${STAMP}`;

let context: BrowserContext;
let page: Page;
let api: APIRequestContext;
let pool: pg.Pool;
let token = "";
const created: string[] = [];

const authed = () => ({ authorization: `Bearer ${token}` });
const main = () => page.locator("#main-content");

async function post<T>(action: string, data: unknown): Promise<T> {
  const response = await api.post(`/api/v1/${action.replace(".", "/")}`, {
    headers: authed(),
    data,
  });
  expect(response.status(), `${action}: ${await response.text()}`).toBe(200);
  return (await response.json()).data as T;
}

test.beforeAll(async ({ browser, playwright, baseURL }) => {
  context = await browser.newContext();
  page = await context.newPage();
  api = await playwright.request.newContext({ baseURL });
  pool = new pg.Pool(
    process.env.DATABASE_URL
      ? { connectionString: process.env.DATABASE_URL }
      : connectionOptions(
          process.env.E2E_DATABASE ?? "openokr_e2e",
          testDbEnv.superuser,
        ),
  );
});

test.afterAll(async () => {
  if (token) {
    for (const id of created) {
      await api.post("/api/v1/goals/delete", {
        headers: authed(),
        data: { id },
      });
    }
  }
  await pool?.end();
  await api?.dispose();
  await context?.close();
});

test("sign in, with two objectives", async () => {
  await signIn(page);
  await goTo(page, "/account/api-tokens");
  await page.getByLabel("Name").fill("Health e2e");
  await page.getByRole("checkbox", { name: "Write" }).check();
  await page.getByRole("checkbox", { name: "Destructive" }).check();
  await page.getByRole("button", { name: "Create token" }).click();
  const shown = page.getByTestId("minted-token");
  await expect(shown).toBeVisible({ timeout: 10_000 });
  token = ((await shown.textContent()) ?? "").trim();

  const cycleId = (
    (await (
      await api.get("/api/v1/cycles/current?mode=quarterly", {
        headers: authed(),
      })
    ).json()).data as { id: string }
  ).id;
  for (const title of [QUIET, STOPPED]) {
    created.push(
      (
        await post<{ id: string }>("goals.create", {
          title,
          cycleId,
          level: "company",
        })
      ).id,
    );
  }
});

test("acceptance: an outdated goal keeps its last status beside it", async () => {
  const [quiet] = created;
  await post("goals.publishDraftedCheckIn", {
    goalId: quiet,
    status: "on_track",
    confidence: 0.7,
    narrative: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Steady." }] }],
    },
  });
  await pool.query("update goals set health = 'outdated' where id = $1", [
    quiet,
  ]);

  await goTo(page, "/goals");
  const row = main()
    .locator(`input[aria-label="Objective title"][value="${QUIET}"]`)
    .locator("xpath=ancestor::div[contains(@class, 'grid')][1]");
  await expect(row.getByTestId("health-chip")).toHaveText(
    "Outdated, last on track",
    { timeout: 15_000 },
  );
});

test("acceptance: an objective stopped mid-cycle reads abandoned, not missed", async () => {
  const stopped = created[1] as string;
  await post("goals.stop", {
    id: stopped,
    reason: "Capacity moves to the competitive response",
  });
  const read = (await (
    await api.get(`/api/v1/goals/read?id=${stopped}`, { headers: authed() })
  ).json()).data as { health: string };
  expect(read.health).toBe("abandoned");
});
