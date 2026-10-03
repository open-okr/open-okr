/**
 * An objective drafted with no reviewer (P9-T04, METHOD.md §2.5,
 * REQUIREMENTS §3.3).
 *
 * The reviewer is optional by default, so the drafting form offers "No
 * reviewer" after the members, and an objective drafted with it reads as
 * having none wherever its roles are shown. That nobody then owes an
 * acknowledgement is proved against rows in
 * `packages/core/test/reviewer-optional.test.ts`; this is the half a person
 * sees.
 *
 * **A quarter three years out, in August**, which no other spec drafts in, so
 * the objective it adds changes no count another spec asserts. Retry-safe: the
 * cycle is found before it is made.
 */
import { connectionOptions, testDbEnv } from "@openokr/test-support/db";
import pg from "pg";
import { expect, test } from "./fixtures.ts";
import { goTo, INSTANCE_ACCOUNT, signIn } from "./instance-account.ts";

const ON = `${new Date().getUTCFullYear() + 3}-08-15`;
const TITLE = "Answer once, in the product, without a reviewer";

// The superuser, for the reason `reviews.spec.ts` gives. It only reads here.
const CONNECTION = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : connectionOptions(
      process.env.E2E_DATABASE ?? "openokr_e2e",
      testDbEnv.superuser,
    );

test("an objective drafted with no reviewer reads as having none", async ({
  page,
}) => {
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
      [INSTANCE_ACCOUNT.email, ON],
    );
    cycleId = found.rows[0]?.id;
  } finally {
    await pool.end();
  }

  await signIn(page);
  if (!cycleId) {
    await goTo(page, "/cycle");
    await page.getByLabel("A date inside the cycle to create").first().fill(ON);
    await page.getByTestId("create-cycle").first().click();
    await expect(page).toHaveURL(/\/cycle\?cycle=[0-9a-f-]{36}/, {
      timeout: 15_000,
    });
    cycleId = new URL(page.url()).searchParams.get("cycle") ?? undefined;
  }
  expect(cycleId, "no cycle was made for the date").toBeTruthy();
  await goTo(page, `/cycle?cycle=${cycleId}&phase=4`);

  const drafted = page.getByRole("heading", { level: 2, name: TITLE });
  if ((await drafted.count()) === 0) {
    await page.getByRole("textbox", { name: "The objective" }).fill(TITLE);
    await page
      .getByRole("textbox", { name: "What it contributes to" })
      .fill("Carries the support load priority");
    await page
      .getByLabel("Reviewer", { exact: true })
      .selectOption({ label: "No reviewer" });
    await page.getByRole("button", { name: "Add objective" }).click();
  }
  await expect(drafted).toBeVisible({ timeout: 15_000 });

  // The objective's own line says so, rather than naming somebody.
  const card = page.locator("div", { has: drafted }).first();
  await expect(card.getByText(/champions it, no reviewer/).first()).toBeVisible();
});
