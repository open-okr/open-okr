/**
 * The drafting assists — P4-T15a (screen S-09, AI-NATIVE-PLAN.md §2.1).
 *
 * Acceptance criterion:
 *   Given the provider off, when a member opens the create form, then no assist
 *   is offered and the Draft Coach behaves exactly as it does today.
 *
 * **That criterion is about absence, so absence is what this file asserts**, and
 * it is the one thing a browser here can prove completely: this instance has no
 * AI provider, which is the state every self-hosted install without an API key
 * runs in. Nothing is offered, and the deterministic surface underneath is
 * whole: the create form works, the Draft Coach evaluates, the chips appear.
 *
 * What the assists do when a provider *is* configured is proved in
 * `packages/core/test/goal-assists.test.ts` against a scripted drafter, because
 * a browser cannot reach it here.
 *
 * **The file name carries the run order.** Specs run alphabetically against one
 * instance and `registration-to-dashboard.spec.ts` is the one that claims it, so
 * anything that signs in must sort after `registration-`. `s09` is screen S-09.
 *
 * The step is `?phase=4`, which is what `page.tsx` reads.
 */
import { expect, test } from "./fixtures.ts";
import type { BrowserContext, Page } from "@playwright/test";
import { connectionOptions, testDbEnv } from "@openokr/test-support/db";
import pg from "pg";
import { goTo, signIn } from "./instance-account.ts";

const CONNECTION = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : connectionOptions(
      process.env.E2E_DATABASE ?? "openokr_e2e",
      // The superuser, for the reason `sessions.spec.ts` records: this looks
      // a goal up by title before any tenant setting could be applied.
      testDbEnv.superuser,
    );

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
});

test.afterAll(async () => {
  await context?.close();
});

test("sign in and reach the drafting step", async () => {
  await signIn(page);
  await expect(
    page.getByRole("heading", { level: 1, name: "Work map" }),
  ).toBeVisible({ timeout: 10_000 });

  await goTo(page, "/cycle?phase=4");
  // The drafting step's own form is the anchor: it is what the acceptance
  // criterion calls "the create form".
  await expect(
    page.getByRole("button", { name: "Add objective" }).first(),
  ).toBeVisible({ timeout: 15_000 });
});

test("no assist is offered anywhere on the step", async () => {
  // Named exactly as the three affordances name themselves, so this fails the
  // day one of them starts rendering without a provider behind it.
  await expect(
    page.getByRole("button", { name: "Draft it" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Suggest numbers" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Suggest a parent" }),
  ).toHaveCount(0);
  await expect(page.getByText("Draft from an ambition")).toHaveCount(0);
});

test("the deterministic create form still works", async () => {
  const title = "Reduce onboarding to two days for mid-market teams";
  await page.getByLabel("The objective").first().fill(title);
  await page.getByRole("button", { name: "Add objective" }).first().click();

  await expect(page.getByText(title).first()).toBeVisible({ timeout: 15_000 });
});

test("the Draft Coach evaluates it, exactly as it does today", async () => {
  // The coach is the deterministic path this row must not disturb. It runs in
  // the browser from `packages/method`, and it says something about every
  // objective on the step: that it says something is the assertion.
  const coach = page.getByRole("region", { name: "Draft Coach" }).first();
  if ((await coach.count()) > 0) {
    await expect(coach).toBeVisible();
    return;
  }
  // The coach's own region is not named in every layout, so fall back to what
  // it renders: a §4 check id, or the strength line it writes under every
  // objective. Until P9-T18a this asked for a check id alone, and found one
  // only because the recovery objective an earlier spec launches carried a
  // number, "Bring Operating margin back to 100", which OBJ-2 flagged. The
  // recovery objective has no number since then.
  await expect(page.getByText(/OBJ-\d|OKR strength/).first()).toBeVisible({
    timeout: 15_000,
  });
});

/**
 * The goal page's assists, absent with the provider off (completeness review
 * M-09).
 *
 * The same criterion as the drafting step, on the screen M-09 gave three
 * assists: the retrospective draft in the close form, the thread summary and
 * the decomposition of a key result. The close form itself, which is the
 * deterministic path the retrospective draft sits beside, is still whole.
 */
test("the goal page offers no assist, and its close form is whole", async () => {
  const pool = new pg.Pool(CONNECTION);
  try {
    const goal = (
      await pool.query<{ id: string }>(
        "select id from goals where title = $1 and deleted_at is null limit 1",
        ["Reduce onboarding to two days for mid-market teams"],
      )
    ).rows[0];
    if (!goal) {
      throw new Error("The objective the create form added is not there.");
    }
    await goTo(page, `/goals/${goal.id}`);
  } finally {
    await pool.end();
  }

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Reduce onboarding to two days for mid-market teams",
    }),
  ).toBeVisible({ timeout: 15_000 });
  for (const name of [
    "Draft from the check-ins",
    "Summarise the discussion",
    "Draft the work",
  ]) {
    await expect(page.getByRole("button", { name })).toHaveCount(0);
  }
  await expect(page.getByLabel("The retrospective")).toBeVisible();
});

test("the KPI grid offers no suggestion, and its add form is whole", async () => {
  await goTo(page, "/kpis");
  await expect(page.getByText("Or describe it in a sentence")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Suggest the fields" }),
  ).toHaveCount(0);
  await expect(page.getByLabel("What is being measured")).toBeVisible({
    timeout: 15_000,
  });
});
