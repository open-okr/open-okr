/**
 * A member's leave, with a delegate (P9-T19b-b, METHOD.md §7.4).
 *
 * Acceptance:
 *   Given Mei on leave with Priya as her delegate, when a check-in on a goal
 *   Mei reviews is published, then Priya owes the acknowledgement and Mei
 *   receives no nudge.
 *
 * Who owes what, and who the nudge run asks, are proved against a real
 * database in `packages/core/test/member-leave.test.ts`. What only a browser
 * shows is the profile card a member marks their own leave on, with nobody
 * chosen to stand in until they choose. The delegate is a member this spec
 * adds and removes, and the leave is cleared afterwards.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { connectionOptions, testDbEnv } from "@openokr/test-support/db";
import pg from "pg";
import { expect, test } from "./fixtures.ts";
import { goTo, INSTANCE_ACCOUNT, signIn } from "./instance-account.ts";

const CONNECTION = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : connectionOptions(
      process.env.E2E_DATABASE ?? "openokr_e2e",
      testDbEnv.superuser,
    );

test.describe.configure({ mode: "serial" });

const STAMP = Date.now().toString(36);
const DELEGATE = `Priya Stand-in ${STAMP}`;

let context: BrowserContext;
let page: Page;
let pool: pg.Pool;
let memberId = "";
let delegateId = "";

test.beforeAll(async ({ browser }) => {
  pool = new pg.Pool(CONNECTION);
  context = await browser.newContext();
  page = await context.newPage();
});

test.afterAll(async () => {
  if (memberId) {
    await pool.query(
      "update member_leave set deleted_at = now() where member_id = $1 and deleted_at is null",
      [memberId],
    );
  }
  if (delegateId) {
    await pool.query(
      "update workspace_members set deleted_at = now() where id = $1",
      [delegateId],
    );
  }
  await pool?.end();
  await context?.close();
});

test("sign in, with a colleague who can stand in", async () => {
  await signIn(page);
  const member = (
    await pool.query<{ id: string; workspace_id: string }>(
      `select m.id, m.workspace_id
         from workspace_members m join users u on u.id = m.user_id
        where u.email = $1 limit 1`,
      [INSTANCE_ACCOUNT.email],
    )
  ).rows[0];
  if (!member) {
    throw new Error("Member not found. Did the claiming spec run?");
  }
  memberId = member.id;
  delegateId = (
    await pool.query<{ id: string }>(
      `insert into workspace_members (id, workspace_id, name, kind, status)
       values (gen_random_uuid(), $1, $2, 'human', 'active') returning id`,
      [member.workspace_id, DELEGATE],
    )
  ).rows[0]?.id as string;
});

test("a member marks their own leave, with the colleague standing in", async () => {
  await goTo(page, `/people/${memberId}`);
  const card = page.getByTestId("member-leave");
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card).toContainText("No leave marked.");

  await card.getByLabel("From").fill("2026-08-23");
  await card.getByLabel("To").fill("2026-08-27");
  // Nobody is chosen for you.
  const mark = card.getByRole("button", { name: "Mark the leave" });
  await expect(mark).toBeDisabled();
  await card.getByLabel("Who stands in").selectOption({ label: DELEGATE });
  await mark.click();

  await expect(card.getByTestId("member-leave-saved")).toBeVisible({
    timeout: 15_000,
  });
  await expect(card).toContainText(
    `2026-08-23 to 2026-08-27, ${DELEGATE} standing in`,
  );
  const stored = (
    await pool.query<{ delegate: string }>(
      `select delegate_member_id as delegate from member_leave
        where member_id = $1 and deleted_at is null`,
      [memberId],
    )
  ).rows;
  expect(stored).toEqual([{ delegate: delegateId }]);

  // It is read back from the member after a reload.
  await page.reload();
  await expect(page.getByTestId("member-leave")).toContainText(DELEGATE, {
    timeout: 15_000,
  });
});

test("taking the leave off leaves none", async () => {
  const card = page.getByTestId("member-leave");
  await card.getByRole("button", { name: /Remove the leave from/ }).click();
  await expect(card).toContainText("No leave marked.", { timeout: 15_000 });
});
