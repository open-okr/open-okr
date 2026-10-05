/**
 * Adding OKRs mid-cycle (P9-T13-a, METHOD.md §2.9).
 *
 * Acceptance:
 *   Given an objective added in week 5, when the cycle closes, then the
 *   review shows it as added mid-cycle with its date.
 *
 * And NW-Q2-13 on screen: with "Reason when adding mid-cycle" required, the
 * list's add row asks why before it saves, and the row carries the mark.
 *
 * And drafts that wait for a person (P9-T13-b-b):
 *   Given a workspace whose mid-cycle objectives start as drafts the reviewer
 *   approves, when the owner publishes one, then it awaits approval, and
 *   when its reviewer approves it, then it is live.
 *
 * And live or draft (P9-T13-b-a, NW-Q3-11):
 *   Given a metric key result added mid-cycle without a target, when it is
 *   saved, then it is a draft its space can see, marked with what is
 *   missing, and it goes live when the target is added.
 *
 * **It moves the current cycle and puts it back.** The window is measured
 * from today, so the spec places the shared quarter five weeks in and
 * published, then restores its dates, its publication and the practice
 * setting, whatever happened.
 */
import { connectionOptions, testDbEnv } from "@openokr/test-support/db";
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import pg from "pg";
import { expect, test } from "./fixtures.ts";
import { goTo, INSTANCE_ACCOUNT, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

const STAMP = Date.now().toString(36);
const LISTED = `Win the teams Brightline is chasing ${STAMP}`;
const REVIEWED = `Answer Brightline's onboarding in week five ${STAMP}`;
const REASON = "Brightline entered the segment on 10 May";
const GROWTH = `Make self-serve a second engine of growth ${STAMP}`;
const CONVERSION = `Self-serve trial-to-paid conversion from 4.1% ${STAMP}`;
const APPROVED = `Open a partner channel for self-serve ${STAMP}`;

let context: BrowserContext;
let page: Page;
let api: APIRequestContext;
let pool: pg.Pool;
let token = "";
let cycleId = "";
let spaceId = "";
let sessionId = "";
const created: string[] = [];
let saved: { starts_on: string; ends_on: string; published_at: Date | null };

const authed = () => ({ authorization: `Bearer ${token}` });
const main = () => page.locator("#main-content");
const today = () => new Date().toISOString().slice(0, 10);

async function post<T>(action: string, data: unknown): Promise<T> {
  const response = await api.post(`/api/v1/${action.replace(".", "/")}`, {
    headers: authed(),
    data,
  });
  expect(response.status(), `${action} answered`).toBe(200);
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
    if (sessionId) {
      await api.post("/api/v1/sessions/close", {
        headers: authed(),
        data: { id: sessionId },
      });
    }
    for (const id of created) {
      await api.post("/api/v1/goals/delete", {
        headers: authed(),
        data: { id },
      });
    }
    if (spaceId) {
      await api.post("/api/v1/spaces/archive", {
        headers: authed(),
        data: { id: spaceId },
      });
    }
    await api.post("/api/v1/practice/update", {
      headers: authed(),
      data: {
        overrides: {
          "reasons.midCycleAddition": null,
          "writing.midCycleAs": null,
        },
      },
    });
  }
  if (saved && cycleId) {
    await pool.query(
      "update cycles set starts_on = $2, ends_on = $3, published_at = $4 where id = $1",
      [cycleId, saved.starts_on, saved.ends_on, saved.published_at],
    );
  }
  await pool?.end();
  await api?.dispose();
  await context?.close();
});

test("sign in, and place the quarter five weeks in and published", async () => {
  await signIn(page);
  await goTo(page, "/account/api-tokens");
  await page.getByLabel("Name").fill("Mid-cycle e2e");
  await page.getByRole("checkbox", { name: "Write" }).check();
  await page.getByRole("checkbox", { name: "Destructive" }).check();
  await page.getByRole("button", { name: "Create token" }).click();
  const shown = page.getByTestId("minted-token");
  await expect(shown).toBeVisible({ timeout: 10_000 });
  token = ((await shown.textContent()) ?? "").trim();

  cycleId = (
    (await (
      await api.get("/api/v1/cycles/current?mode=quarterly", {
        headers: authed(),
      })
    ).json()).data as { id: string }
  ).id;
  const { rows } = await pool.query<typeof saved>(
    "select starts_on::text, ends_on::text, published_at from cycles where id = $1",
    [cycleId],
  );
  saved = rows[0] as typeof saved;
  await pool.query(
    `update cycles
        set starts_on = current_date - 30,
            ends_on = current_date + 60,
            published_at = now()
      where id = $1`,
    [cycleId],
  );
  await post("practice.update", {
    overrides: { "reasons.midCycleAddition": "required" },
  });
});

test("NW-Q2-13: the list asks why before an addition saves, and marks it", async () => {
  await goTo(page, "/goals");
  await main().getByRole("button", { name: "Add objective" }).last().click();
  await page.keyboard.type(LISTED);
  const save = main()
    .getByRole("button", { name: "Save", exact: true })
    .last();
  // Required, so the row will not save on a title alone.
  await expect(save).toBeDisabled();
  await main()
    .getByRole("textbox", {
      name: "Why it starts now (required, it is added mid-cycle)",
    })
    .fill(REASON);
  await save.click();

  const row = main()
    .locator(`input[aria-label="Objective title"][value="${LISTED}"]`)
    .locator("xpath=ancestor::div[contains(@class, 'grid')][1]");
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row.getByTestId("added-mid-cycle")).toHaveText(
    `Added mid-cycle, ${today()}`,
  );
  const listed = (await (
    await api.get("/api/v1/goals/list", { headers: authed() })
  ).json()).data.goals as { id: string; title: string }[];
  const id = listed.find((goal) => goal.title === LISTED)?.id;
  expect(id).toBeTruthy();
  created.push(id as string);
});

test("acceptance: the review shows an objective added in week five as added mid-cycle, with its date", async () => {
  const directory = (await (
    await api.get("/api/v1/people/directory", { headers: authed() })
  ).json()).data as { id: string; name: string }[];
  const me = directory.find((member) => member.name === INSTANCE_ACCOUNT.name);
  spaceId = (
    await post<{ id: string }>("spaces.create", {
      name: `Mid-cycle review ${STAMP}`,
    })
  ).id;
  const goalId = (
    await post<{ id: string }>("goals.create", {
      title: REVIEWED,
      cycleId,
      spaceId,
      level: "team",
      ownerKind: "space",
      reason: REASON,
    })
  ).id;
  created.push(goalId);
  await post("goals.addKeyResult", {
    goalId,
    title: "Teams moving from Brightline from 0 to 20",
    direction: "increase",
    indicatorType: "lagging",
    baselineValue: 0,
    targetValue: 20,
    reason: REASON,
  });
  sessionId = (
    await post<{ id: string }>("sessions.create", {
      spaceId,
      cycleId,
      kind: "quarterly",
      title: `Q review ${STAMP}`,
      scheduledFor: new Date().toISOString(),
      facilitatorId: me?.id,
    })
  ).id;
  await post("sessions.open", { id: sessionId });
  await post("sessions.advanceStage", { id: sessionId });

  await goTo(page, `/session/${sessionId}`);
  await expect(page.getByText(/Stage 2 of 11/)).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("added-mid-cycle")).toHaveText(
    `Added mid-cycle, ${today()}`,
  );
});

test("acceptance (P9-T13-b-a): a key result saved without its target is a draft naming it, and goes live as the target is typed", async () => {
  const directory = (await (
    await api.get("/api/v1/people/directory", { headers: authed() })
  ).json()).data as { id: string; name: string }[];
  const me = directory.find((member) => member.name === INSTANCE_ACCOUNT.name);
  const goalId = (
    await post<{ id: string }>("goals.create", {
      title: GROWTH,
      cycleId,
      level: "company",
      ownerKind: "workspace",
      championId: me?.id,
      reason: "New Growth team formed 9 August",
    })
  ).id;
  created.push(goalId);
  // The target is not known yet, so it is left out (NW-Q3-11).
  await post("goals.addKeyResult", {
    goalId,
    title: CONVERSION,
    direction: "increase",
    indicatorType: "lagging",
    baselineValue: 4.1,
    dueOn: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
    ownerId: me?.id,
    reason: "Baseline established on 23 August",
  });

  await goTo(page, "/goals");
  const target = main().getByLabel(`Target for ${CONVERSION}`);
  await expect(target).toBeVisible({ timeout: 15_000 });
  await expect(target).toHaveValue("");
  const row = target.locator("xpath=ancestor::div[contains(@class, 'grid')][1]");
  await expect(row.getByTestId("addition-draft")).toHaveText(
    "Draft: needs a target",
  );

  await target.fill("7");
  await target.press("Enter");
  await expect(row.getByTestId("addition-draft")).toHaveCount(0, {
    timeout: 15_000,
  });
  await expect(row.getByTestId("added-mid-cycle")).toBeVisible();
});

test("acceptance (P9-T13-b-b): a draft its owner publishes waits for its reviewer, and is live once approved", async () => {
  await post("practice.update", {
    overrides: { "writing.midCycleAs": "reviewerApproval" },
  });
  const directory = (await (
    await api.get("/api/v1/people/directory", { headers: authed() })
  ).json()).data as { id: string; name: string }[];
  const me = directory.find((member) => member.name === INSTANCE_ACCOUNT.name);
  // The one account is both its owner and its reviewer, so it meets both
  // steps; who may take each is the policy's, proven in the action tests.
  const goalId = (
    await post<{ id: string }>("goals.create", {
      title: APPROVED,
      cycleId,
      level: "company",
      ownerKind: "workspace",
      championId: me?.id,
      reviewerId: me?.id,
      reason: "A partner asked to resell self-serve seats",
    })
  ).id;
  created.push(goalId);

  await goTo(page, "/goals");
  const row = main()
    .locator(`input[aria-label="Objective title"][value="${APPROVED}"]`)
    .locator("xpath=ancestor::div[contains(@class, 'grid')][1]");
  const waiting = row.getByTestId("waiting-draft");
  await expect(waiting).toContainText(
    "Draft, waiting for its owner to publish",
    { timeout: 15_000 },
  );

  await row.getByRole("button", { name: `Publish ${APPROVED}` }).click();
  await expect(waiting).toContainText("Waiting for its reviewer's approval", {
    timeout: 15_000,
  });

  await row.getByRole("button", { name: `Approve ${APPROVED}` }).click();
  await expect(waiting).toHaveCount(0, { timeout: 15_000 });
  await expect(row.getByTestId("added-mid-cycle")).toBeVisible();
});
