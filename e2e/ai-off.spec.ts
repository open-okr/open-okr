/**
 * The AI-off leg (PLAN.md §9, AI-NATIVE-PLAN §10, release 0.7.0 A12,
 * `docs/design/ai-off-leg.md` §7).
 *
 * Acceptance criteria:
 *   Given the end-to-end instance, booted with no AI provider,
 *   when a member opens the copilot, then it says AI off;
 *   when they walk the main screens, then none draws an AI affordance;
 *   when an administrator runs the Champion and the Coach, then both runs
 *   complete, deterministically, with what they decided in their log.
 *
 * **The first test is the leg's own guard.** Every other spec in the run
 * assumes AI is off. If a provider reached this member, through the
 * environment, a stored deployment key, the workspace's own or their personal
 * one, the copilot would answer and this fails saying so, rather than twenty
 * unrelated specs each finding an assist they did not expect.
 *
 * **An AI affordance is found by its mark, not its words.** UIUX-PLAN §2's ✨
 * action is the `ai` button variant, which carries `data-ai-affordance`, so an
 * assist added tomorrow is caught here without anybody adding its label.
 * `packages/ui/test/components.test.tsx` proves the mark is there, and
 * `apps/web/test/ai-off-leg.test.ts` that every file drawing the ✨ draws it
 * on that variant. Each screen's own spec asserts its assists by name too.
 *
 * Relies on the claim and nothing else: it makes the objective it opens.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { connectionOptions, testDbEnv } from "@openokr/test-support/db";
import pg from "pg";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

const CONNECTION = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : connectionOptions(
      process.env.E2E_DATABASE ?? "openokr_e2e",
      // The superuser, for the reason `sessions.spec.ts` records: this looks
      // rows up before any tenant setting could be applied.
      testDbEnv.superuser,
    );

/** What every AI affordance carries, and nothing else does. */
const AI_AFFORDANCE = "[data-ai-affordance]";

const TITLE = "Halve the time a new team takes to run its first check-in";

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

/** Opens a screen and waits for its content, then finds no AI affordance. */
async function noAffordanceOn(url: string): Promise<void> {
  await goTo(page, url);
  // `first`, because Admin's layout draws a `main` of its own inside the
  // shell's.
  await expect(page.getByRole("main").first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator(AI_AFFORDANCE), url).toHaveCount(0);
}

async function firstRow<T extends Record<string, unknown>>(
  query: string,
  values: unknown[] = [],
): Promise<T> {
  const pool = new pg.Pool(CONNECTION);
  try {
    const row = (await pool.query<T>(query, values)).rows[0];
    if (!row) {
      throw new Error(`Nothing answered: ${query}`);
    }
    return row;
  } finally {
    await pool.end();
  }
}

test("the instance has no AI provider for this member", async () => {
  await signIn(page);
  await expect(
    page.getByRole("heading", { level: 1, name: "Work map" }),
  ).toBeVisible({ timeout: 15_000 });

  // The copilot asks the same question every assist asks: is there a model
  // this member's request could reach. "AI off" is its answer being no.
  await page.keyboard.press("ControlOrMeta+j");
  const panel = page.getByRole("dialog", { name: "Copilot" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("AI off")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+j");
  await expect(panel).toBeHidden();
});

test("no main screen draws an AI affordance", async () => {
  for (const url of [
    "/",
    "/goals",
    "/cycle?phase=4",
    "/kpis",
    "/sessions",
    "/inbox",
    "/review",
    "/activity",
    "/search",
    "/admin/imports",
    "/admin/agents",
  ]) {
    await noAffordanceOn(url);
  }

  // The KPI suggestion lives in the new KPI panel, behind a link.
  await goTo(page, "/kpis");
  await page.getByRole("link", { name: "New KPI", exact: true }).click();
  await expect(page.getByTestId("kpi-kpi-panel")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator(AI_AFFORDANCE)).toHaveCount(0);

  // A space's home, where the blocker summary would be.
  const space = await firstRow<{ id: string }>(
    "select id from spaces where deleted_at is null order by created_at limit 1",
  );
  await noAffordanceOn(`/spaces/${space.id}`);
});

test("a goal's page draws none either, and its close form is whole", async () => {
  // Made here rather than found, so this file needs nothing another spec left.
  await goTo(page, "/cycle?phase=4");
  await page.getByLabel("The objective").first().fill(TITLE);
  await page.getByRole("button", { name: "Add objective" }).first().click();
  await expect(page.getByText(TITLE).first()).toBeVisible({ timeout: 15_000 });

  const goal = await firstRow<{ id: string }>(
    "select id from goals where title = $1 and deleted_at is null limit 1",
    [TITLE],
  );
  await goTo(page, `/goals/${goal.id}`);
  await expect(
    page.getByRole("heading", { level: 1, name: TITLE }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(AI_AFFORDANCE)).toHaveCount(0);
  // The deterministic path the retrospective draft would sit beside.
  await expect(page.getByLabel("The retrospective")).toBeVisible();

  // Taken away again through the page's own control. `reviews.spec.ts` can
  // share this instance on a shard and counts the objectives in this cycle's
  // first space, so an objective left here changes its review.
  await page.locator("details summary").filter({ hasText: "Manage this goal" }).click();
  await page.getByRole("button", { name: "Delete this goal" }).click();
  await expect(page.getByText("Goal deleted")).toBeVisible({
    timeout: 10_000,
  });
});

test("the Champion and the Coach run, deterministically", async () => {
  await goTo(page, "/admin/agents");
  // Stated, not hidden: deterministic only is a whole product.
  await expect(page.getByText("Deterministic only")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("Drafting on")).toBeHidden();

  // Newest first. The scheduler runs the Champion on its own too, and any of
  // its runs is the same deterministic run, so the newest is the one read.
  const latest = (agent: string, schedule: string) =>
    page
      .getByRole("listitem")
      .filter({ hasText: agent })
      .filter({ hasText: schedule })
      .first();

  await page.getByRole("button", { name: "Nudge queue" }).click();
  const champion = latest("OKR Champion", "Every hour");
  await expect(champion.getByText("completed", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  // Its log says what it decided: how many it delivered and how many it held,
  // each with a reason. That line is computed with no model at all.
  await expect(champion).toContainText("held with a reason");

  await page.getByRole("button", { name: "Quality pass" }).click();
  const coach = latest("OKR Coach", "The nightly quality sweep");
  await expect(coach.getByText("completed", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(coach).toContainText("held with a reason");

  // And it spent nothing and proposed nothing it would have needed a model
  // for: no run of either agent has a cost.
  const spent = await firstRow<{ spent: string }>(
    `select coalesce(sum(r.cost), 0)::text as spent
       from agent_runs r
       join agents a on a.id = r.agent_id
      where a.kind in ('coach', 'champion')`,
  );
  expect(Number(spent.spent)).toBe(0);
});
