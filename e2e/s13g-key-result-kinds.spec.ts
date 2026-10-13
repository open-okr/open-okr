/**
 * Kinds of key result on screen (P9-T12c-a, METHOD.md §2.10).
 *
 * Acceptance:
 *   Given "No one on the team experienced a major injury" added as a
 *   milestone from the list, when it is checked as done, then it reads 100%
 *   and KR-2 passes.
 *
 * It also walks the Northwind steps the kinds carry: a baseline that passes
 * its checks and is recorded by its first value (NW-Q1-07), then given a
 * target as a metric (NW-Q2-16); a maintain key result reading its band
 * (NW-Q4-04); and a milestone done from the check-in composer (NW-Q3-13).
 *
 * **It leaves what it found.** The objective it adds is deleted at the end,
 * whatever happened.
 */
import { connectionOptions, testDbEnv } from "@openokr/test-support/db";
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import pg from "pg";
import { expect, test } from "./fixtures.ts";
import { goTo, INSTANCE_ACCOUNT, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

const OBJECTIVE = "Ship the bulk import and keep the whole team safe";
const MILESTONE = "No one on the team experienced a major injury";
const BASELINE = "Establish an onboarding NPS baseline";
const MAINTAIN = "Hold uptime between 99.5% and 99.9%";
const SOC2 = "The SOC 2 Type II report is issued";
const NARRATIVE = "The auditor signed the report three days early.";

let context: BrowserContext;
let page: Page;
let api: APIRequestContext;
let pool: pg.Pool;
let token = "";
let goalId = "";

const authed = () => ({ authorization: `Bearer ${token}` });
const main = () => page.locator("#main-content");
const drawer = () => page.getByTestId("okr-drawer");
const keyResultRow = (title: string) =>
  main()
    .locator(`input[aria-label="Key result title"][value="${title}"]`)
    .locator("xpath=ancestor::div[contains(@class, 'grid')][1]");

async function post<T>(action: string, data: unknown): Promise<T> {
  const response = await api.post(`/api/v1/${action.replace(".", "/")}`, {
    headers: authed(),
    data,
  });
  expect(response.status(), `${action} answered`).toBe(200);
  return (await response.json()).data as T;
}

async function readGoal() {
  const response = await api.get(`/api/v1/goals/read?id=${goalId}`, {
    headers: authed(),
  });
  return (await response.json()).data as {
    keyResults: {
      title: string;
      kind: string;
      doneAt: string | null;
      progressPct: number;
    }[];
  };
}

/** The list has said every change reached the server. */
const settled = () =>
  expect(main().getByTestId("okr-list")).toHaveAttribute(
    "aria-busy",
    "false",
    { timeout: 15_000 },
  );

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
  if (token && goalId) {
    const deleted = await api.post("/api/v1/goals/delete", {
      headers: authed(),
      data: { id: goalId },
    });
    expect(deleted.status()).toBe(200);
  }
  await pool?.end();
  await api?.dispose();
  await context?.close();
});

test("sign in, with a token and an objective to hold the key results", async () => {
  await signIn(page);
  await goTo(page, "/account/api-tokens");
  await page.getByLabel("Name").fill("Key result kinds e2e");
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
  const cycle = (await (
    await api.get("/api/v1/cycles/current?mode=quarterly", {
      headers: authed(),
    })
  ).json()).data as { id: string; endsOn: string };
  goalId = (
    await post<{ id: string }>("goals.create", {
      title: OBJECTIVE,
      cycleId: cycle.id,
      level: "team",
      ownerKind: "workspace",
    })
  ).id;
  const due = { dueOn: cycle.endsOn, ownerId: me?.id };
  await post("goals.addKeyResult", {
    goalId,
    title: BASELINE,
    kind: "baseline",
    indicatorType: "lagging",
    ...due,
  });
  await post("goals.addKeyResult", {
    goalId,
    title: MAINTAIN,
    direction: "maintain",
    indicatorType: "lagging",
    baselineValue: 99.5,
    targetValue: 99.9,
    currentValue: 99.7,
    unit: "%",
    ...due,
  });
  await post("goals.addKeyResult", {
    goalId,
    title: SOC2,
    kind: "milestone",
    indicatorType: "lagging",
    ...due,
  });
});

test("acceptance: a milestone added from the list and checked done reads 100%, and KR-2 passes", async () => {
  await goTo(page, "/goals");
  const objectiveRow = main()
    .locator(`input[aria-label="Objective title"][value="${OBJECTIVE}"]`)
    .locator("xpath=ancestor::div[contains(@class, 'grid')][1]");
  await expect(objectiveRow).toBeVisible({ timeout: 15_000 });
  await objectiveRow
    // The button reads "+ Add key result", its glyph hidden from a reader.
    .locator(
      "xpath=following::button[contains(normalize-space(.), 'Add key result')][1]",
    )
    .click();
  await page.keyboard.type(MILESTONE);
  await page.keyboard.press("Enter");
  await expect(keyResultRow(MILESTONE)).toBeVisible({ timeout: 15_000 });
  await settled();

  // Written as a metric, its words carry no numbers, so KR-2 warns.
  await expect(keyResultRow(MILESTONE)).toContainText("KR-2");
  await keyResultRow(MILESTONE)
    .getByRole("combobox", { name: `Kind of key result ${MILESTONE}` })
    .selectOption("milestone");
  await settled();
  await expect(keyResultRow(MILESTONE)).not.toContainText("KR-2", {
    timeout: 15_000,
  });

  await keyResultRow(MILESTONE)
    .getByRole("checkbox", { name: `${MILESTONE} is done` })
    .check();
  await settled();
  await expect(keyResultRow(MILESTONE)).toContainText("100%", {
    timeout: 15_000,
  });
  const stored = (await readGoal()).keyResults.find(
    (entry) => entry.title === MILESTONE,
  );
  expect(stored?.kind).toBe("milestone");
  expect(stored?.doneAt).not.toBeNull();
});

test("NW-Q1-07 and NW-Q2-16: a baseline passes its checks, is recorded by its first value, then takes a target", async () => {
  await goTo(page, "/goals");
  await expect(keyResultRow(BASELINE)).toBeVisible({ timeout: 15_000 });
  // No numbers and still verifiable and complete (METHOD.md §4.2).
  await expect(keyResultRow(BASELINE)).not.toContainText("KR-2");
  await expect(keyResultRow(BASELINE)).not.toContainText("KR-3");
  await expect(keyResultRow(BASELINE)).toContainText("0%");

  const record = keyResultRow(BASELINE).getByLabel(
    `The baseline for ${BASELINE}`,
  );
  await record.fill("31");
  await record.press("Enter");
  await settled();
  await expect(keyResultRow(BASELINE)).toContainText("100%", {
    timeout: 15_000,
  });

  // Next quarter it becomes a metric from the number it found.
  await keyResultRow(BASELINE)
    .getByRole("combobox", { name: `Kind of key result ${BASELINE}` })
    .selectOption("metric");
  await settled();
  const target = keyResultRow(BASELINE).getByLabel(`Target for ${BASELINE}`);
  await expect(target).toBeVisible({ timeout: 15_000 });
  await target.fill("40");
  await target.press("Enter");
  await settled();
  await expect(
    keyResultRow(BASELINE).getByLabel(`Baseline for ${BASELINE}`),
  ).toHaveValue("31");
});

test("NW-Q4-04: a maintain key result reads its band", async () => {
  await goTo(page, "/goals");
  const row = keyResultRow(MAINTAIN);
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(
    row.getByRole("combobox", { name: `Kind of key result ${MAINTAIN}` }),
  ).toHaveValue("maintain");
  await expect(row).toContainText("Band");
  await expect(row).toContainText("100%");
});

test("NW-Q3-13: a milestone is done from the check-in composer", async () => {
  // Due now, so the composer opens a draft for it, as the check-in spec does.
  await pool.query(
    "update goals set next_check_in_at = now() - interval '1 hour' where id = $1",
    [goalId],
  );
  await goTo(page, `/check-in?goal=${goalId}`);
  const done = page.getByRole("checkbox", { name: `${SOC2} is done` });
  await expect(done).toBeVisible({ timeout: 15_000 });
  await done.check();
  await page.getByLabel("Status", { exact: true }).selectOption("on_track");
  await page
    .getByRole("textbox", {
      name: "What moved, what is in the way, what happens next",
    })
    .fill(NARRATIVE);
  await page
    .getByRole("main")
    .getByRole("button", { name: "Publish", exact: true })
    .click();
  await expect(async () => {
    const soc2 = (await readGoal()).keyResults.find(
      (entry) => entry.title === SOC2,
    );
    expect(soc2?.doneAt).not.toBeNull();
    expect(soc2?.progressPct).toBe(100);
  }).toPass({ timeout: 15_000 });
});
