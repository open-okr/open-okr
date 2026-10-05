/**
 * A closed cycle keeps the rules it was graded under (P9-T14b, METHOD.md §12).
 *
 * Acceptance A7:
 *   Given a closed cycle scored under score bands 1.0, 0.6 and 0.3, when an
 *   admin changes the bands to Doerr's colours, then the closed cycle's
 *   verdicts are unchanged, and the open cycle uses the new colours.
 *
 * **It closes a quarter two years back, not the shared one.** Every other
 * spec reads the current quarter, so this makes its own, grades it through
 * the API and closes it, and puts the colours back whatever happened.
 *
 * **And it takes the quarter away again.** Four specs put their objectives in
 * the workspace's earliest cycle, and a closed quarter two years back is the
 * earliest one there is: `s39b-copilot-proposals` was refused "That cycle is
 * closed" the first time this ran. A closed cycle has no action to remove it,
 * so it is soft-deleted directly, as other specs move cycles directly.
 */
import { connectionOptions, testDbEnv } from "@openokr/test-support/db";
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import pg from "pg";
import { expect, test } from "./fixtures.ts";
import { goTo, INSTANCE_ACCOUNT, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

const STAMP = Date.now().toString(36);

let context: BrowserContext;
let page: Page;
let api: APIRequestContext;
let pool: pg.Pool;
let token = "";
let cycleId = "";
let spaceId = "";

const authed = () => ({ authorization: `Bearer ${token}` });

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
    await api.post("/api/v1/practice/update", {
      headers: authed(),
      data: { overrides: { "scoring.colours": null } },
    });
    if (spaceId) {
      await api.post("/api/v1/spaces/archive", {
        headers: authed(),
        data: { id: spaceId },
      });
    }
  }
  if (cycleId) {
    await pool.query(
      "update cycles set deleted_at = now() where id = $1 and deleted_at is null",
      [cycleId],
    );
  }
  await pool?.end();
  await api?.dispose();
  await context?.close();
});

test("a quarter two years back, graded 0.65 and closed under Google's colours", async () => {
  await signIn(page);
  await goTo(page, "/account/api-tokens");
  await page.getByLabel("Name").fill("Cycle rules e2e");
  await page.getByRole("checkbox", { name: "Write" }).check();
  await page.getByRole("checkbox", { name: "Destructive" }).check();
  await page.getByRole("button", { name: "Create token" }).click();
  const shown = page.getByTestId("minted-token");
  await expect(shown).toBeVisible({ timeout: 10_000 });
  token = ((await shown.textContent()) ?? "").trim();

  const directory = (await (
    await api.get("/api/v1/people/directory", { headers: authed() })
  ).json()).data as { id: string; name: string }[];
  const me = directory.find((member) => member.name === INSTANCE_ACCOUNT.name);

  cycleId = (
    await post<{ id: string }>("cycles.create", {
      on: `${new Date().getUTCFullYear() - 2}-05-15`,
      cadence: "quarterly",
    })
  ).id;
  spaceId = (
    await post<{ id: string }>("spaces.create", { name: `Rules ${STAMP}` })
  ).id;
  const goalId = (
    await post<{ id: string }>("goals.create", {
      title: `Become the platform mid-market teams reach for first ${STAMP}`,
      cycleId,
      spaceId,
      level: "team",
      ownerKind: "space",
    })
  ).id;
  const keyResultId = (
    await post<{ id: string }>("goals.addKeyResult", {
      goalId,
      title: `Weekly active teams from 120 to 300 ${STAMP}`,
      direction: "increase",
      indicatorType: "leading",
      baselineValue: 120,
      targetValue: 300,
    })
  ).id;
  const sessionId = (
    await post<{ id: string }>("sessions.create", {
      spaceId,
      cycleId,
      kind: "quarterly",
      title: `Rules review ${STAMP}`,
      scheduledFor: new Date().toISOString(),
      facilitatorId: me?.id,
    })
  ).id;
  await post("sessions.open", { id: sessionId });
  await post("sessions.scoreKeyResult", {
    sessionId,
    keyResultId,
    score: 0.65,
    reason: "Landed most of the way.",
  });
  await post("sessions.addRetroNote", {
    sessionId,
    columnKey: "didnt",
    text: "Nobody owned the integration dependency.",
    anonymous: false,
  });
  await post("sessions.submitProcessHealth", {
    sessionId,
    scores: [5, 4, 2, 5, 4].map((score, index) => ({
      statementKey: index + 1,
      score,
    })),
  });
  await post("sessions.close", { id: sessionId });
  await post("cycles.close", { cycleId });
});

test("acceptance A7: Doerr's colours leave the closed cycle's bands alone, and the open cycle takes them", async () => {
  await post("practice.update", {
    overrides: { "scoring.colours": "doerr" },
  });

  await goTo(page, `/cycle?cycle=${cycleId}&phase=7`);
  const closedStrong = page.locator(
    '[data-testid="score-band-row"][data-band="strong"]',
  );
  await expect(closedStrong).toContainText("0.60 to 1.00", {
    timeout: 15_000,
  });

  await goTo(page, "/cycle?phase=7");
  await expect(
    page.locator('[data-testid="score-band-row"][data-band="strong"]'),
  ).toContainText("0.70 to 1.00", { timeout: 15_000 });
});
