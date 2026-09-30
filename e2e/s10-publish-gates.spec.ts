/**
 * A set is published past red gates, with a reason, and the audit trail names
 * it (completeness review L-17, UIUX-PLAN.md §4 S-10, METHOD.md §4.5).
 *
 * The six gates are proved against rows in `packages/core/test`, including the
 * refusal and the override. What only a browser settles is the screen's half:
 * that a set with an unmet gate cannot be published by the plain button, that
 * the way past it asks for a sentence, and that the sentence lands in the
 * trail an administrator reads under its own action name.
 *
 * **A quarter two years out, not this one.** Publishing moves a cycle to
 * phase 6 for good, and every later spec that drafts does it in the quarter
 * containing today. A cycle nobody else opens can be published without
 * changing what they see. Its set is empty, which is also what makes the gates
 * red without this file having to break anything.
 *
 * **Retry-safe on purpose.** Continuous integration retries once, and a cycle
 * can be made once and published once. So the cycle is looked up before it is
 * made, and a publish that already happened is asserted rather than repeated.
 *
 * **The file name carries the run order.** `registration-to-dashboard.spec.ts`
 * claims the instance; `s10` is screen S-10.
 */
import { connectionOptions, testDbEnv } from "@openokr/test-support/db";
import pg from "pg";
import { expect, test } from "./fixtures.ts";
import { goTo, INSTANCE_ACCOUNT, signIn } from "./instance-account.ts";

const REASON =
  "The board approved this set on Tuesday; the dependency owners confirm next week.";

// The superuser, for the reason `reviews.spec.ts` gives. It only reads here.
const CONNECTION = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : connectionOptions(
      process.env.E2E_DATABASE ?? "openokr_e2e",
      testDbEnv.superuser,
    );

test("a set with red gates is published past them, and the trail says why", async ({
  page,
}) => {
  // Mid-quarter, so no workspace timezone can put it in a neighbouring one.
  const on = `${new Date().getUTCFullYear() + 2}-08-15`;
  const pool = new pg.Pool(CONNECTION);
  let cycleId: string | undefined;
  try {
    const found = await pool.query<{ id: string }>(
      `select c.id
         from cycles c
         join workspace_members m on m.workspace_id = c.workspace_id
         join users u on u.id = m.user_id
        where u.email = $1 and m.deleted_at is null and c.deleted_at is null
          and c.mode = 'quarterly' and $2::date between c.starts_on and c.ends_on
        limit 1`,
      [INSTANCE_ACCOUNT.email, on],
    );
    cycleId = found.rows[0]?.id;
  } finally {
    await pool.end();
  }

  await signIn(page);
  if (!cycleId) {
    await goTo(page, "/cycle");
    await page.getByLabel("A date inside the cycle to create").first().fill(on);
    await page.getByTestId("create-cycle").first().click();
    // The new cycle opens once it exists.
    await expect(page).toHaveURL(/\/cycle\?cycle=[0-9a-f-]{36}/, {
      timeout: 15_000,
    });
    cycleId = new URL(page.url()).searchParams.get("cycle") ?? undefined;
  }
  expect(cycleId, "no cycle was made for the date").toBeTruthy();

  await goTo(page, `/cycle?cycle=${cycleId}&phase=5`);
  await expect(
    page.getByRole("heading", { level: 2, name: "Publish gates" }),
  ).toBeVisible({ timeout: 15_000 });

  const published = page.getByText(/^Published .+\.$/);
  if ((await published.count()) === 0) {
    // An empty set cannot clear every gate, so the plain button is offered and
    // refused, with the rule beside it rather than a silent grey.
    await expect(page.getByText(/^[0-5] of 6 green$/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Publish the set" }),
    ).toBeDisabled();
    await expect(
      page.getByText(/^All six gates have to be green\./),
    ).toBeVisible();

    await page.getByText("Publish anyway, past the red gates").click();
    const why = page.getByLabel(/^Why is this set being published with \d+ gates? unmet\?$/);
    await expect(why).toBeVisible();
    await why.fill(REASON);
    await page.getByRole("button", { name: "Override and publish" }).click();
  }

  await expect(published).toBeVisible({ timeout: 15_000 });
  // Published is final: neither way to publish is offered again.
  await expect(
    page.getByRole("button", { name: "Publish the set" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Override and publish" }),
  ).toHaveCount(0);

  // An override is its own action in the trail, so "has anybody published past
  // a red gate" is a filter rather than a search through payloads.
  await goTo(page, "/admin/audit");
  await page.getByLabel("Action").fill("workflow.override");
  await page.getByRole("button", { name: "Show matching rows" }).click();
  const rows = page.getByTestId("audit-row");
  await expect(rows.first()).toContainText("workflow.override", {
    timeout: 15_000,
  });
  await expect(rows.first()).toContainText(INSTANCE_ACCOUNT.name);
});
