/**
 * The import wizard, in a browser (UIUX-PLAN.md §6 S-36, P6-T01b-b).
 *
 * Acceptance criterion:
 *   Given a goals spreadsheet with unfamiliar headers, when the wizard runs,
 *   then a mapping is proposed, the human confirms or corrects it, the dry run
 *   reports accurately and the real run matches it.
 *
 * **The proposal half is deliberately absent here, and that is the point.**
 * The end-to-end instance has no AI provider, so `imports.proposeMapping`
 * answers null and every column arrives from the template's aliases. This spec
 * therefore proves the other half of the criterion: with no provider at all, a
 * file whose headers nothing recognises is still importable, because the person
 * names the columns themselves. What the proposal does with a provider is
 * proved against a scripted drafter in `packages/core`.
 *
 * **A browser rather than a unit test, because the criterion is about the four
 * steps.** That the report the wizard shows is the report the command prints is
 * settled in `packages/core/test/import-table.test.ts`. What only a browser can
 * prove is that a file becomes a table, that the table survives the mapping
 * step unchanged, that the preview writes nothing and the confirmation does.
 *
 * **The file name carries the run order:** specs run alphabetically against one
 * instance and `registration-to-dashboard.spec.ts` claims it, so anything that
 * signs in sorts after `registration-`.
 */
import { connectionOptions, testDbEnv } from "@openokr/test-support/db";
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { goTo, INSTANCE_ACCOUNT, signIn } from "./instance-account.ts";

const CONNECTION = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : connectionOptions(
      process.env.E2E_DATABASE ?? "openokr_e2e",
      testDbEnv.superuser,
    );

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let pool: pg.Pool;
let workspaceId: string;

/**
 * Headers no alias matches, which is what the mapping step exists for.
 *
 * The third row's level is invented, so it is the row the report has to name.
 */
const CSV = [
  "Ref,Statement,Band,Opens,Closes,Runner,Checker",
  `imp-1,Make the import obvious,company,2026-01-01,2026-03-31,${INSTANCE_ACCOUNT.email},${INSTANCE_ACCOUNT.email}`,
  `imp-2,Cut the time to first import,company,2026-01-01,2026-03-31,${INSTANCE_ACCOUNT.email},${INSTANCE_ACCOUNT.email}`,
  `imp-3,Something at an invented level,divisional,2026-01-01,2026-03-31,${INSTANCE_ACCOUNT.email},${INSTANCE_ACCOUNT.email}`,
].join("\n");

const COLUMNS: readonly (readonly [string, string])[] = [
  ["Ref", "externalId"],
  ["Statement", "title"],
  ["Band", "level"],
  ["Opens", "startsOn"],
  ["Closes", "endsOn"],
  ["Runner", "champion"],
  ["Checker", "reviewer"],
];

async function upload(): Promise<void> {
  await goTo(page, "/admin/imports");
  await page
    .getByTestId("import-file")
    .setInputFiles({
      name: "objectives.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(CSV, "utf8"),
    });
  await page.getByRole("button", { name: "Read the file" }).click();
}

async function confirmColumns(): Promise<void> {
  for (const [header, field] of COLUMNS) {
    await page.getByLabel(`What ${header} is`).selectOption(field);
  }
}

test.beforeAll(async ({ browser }) => {
  pool = new pg.Pool(CONNECTION);
  context = await browser.newContext();
  page = await context.newPage();
});

test.afterAll(async () => {
  if (workspaceId) {
    await pool
      .query(
        "update workspaces set settings = settings - 'importRowLimit' where id = $1",
        [workspaceId],
      )
      .catch(() => undefined);
  }
  await pool?.end();
  await context?.close();
});

test("sign in and reach the import card", async () => {
  await signIn(page);
  await goTo(page, "/admin/imports");
  await expect(
    page.getByRole("heading", { level: 1, name: "Import" }),
  ).toBeVisible({ timeout: 10_000 });

  const member = (
    await pool.query<{ workspace_id: string }>(
      `select m.workspace_id from workspace_members m
         join users u on u.id = m.user_id
        where u.email = $1
        limit 1`,
      [INSTANCE_ACCOUNT.email],
    )
  ).rows[0];
  if (!member) {
    throw new Error("Member not found. Did the claiming spec run?");
  }
  workspaceId = member.workspace_id;
});

test("a file with unfamiliar headers arrives at the mapping step unclaimed", async () => {
  await upload();

  await expect(page.getByTestId("import-columns")).toBeVisible({
    timeout: 15_000,
  });
  // Nothing was recognised, so the required fields are all still missing and
  // the preview is refused until the person answers.
  await expect(page.getByTestId("import-missing")).toContainText("externalId");
  await expect(page.getByTestId("import-preview")).toBeDisabled();
  // No provider on this instance, so no proposal and no chip claiming one.
  await expect(page.getByTestId("import-notes")).toHaveCount(0);
});

test("acceptance: the dry run reports accurately, and writes nothing", async () => {
  await confirmColumns();
  await expect(page.getByTestId("import-missing")).toHaveCount(0);
  await page.getByTestId("import-preview").click();

  await expect(page.getByTestId("import-counts")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("import-counts")).toContainText("To create");
  await expect(page.getByTestId("import-rows")).toContainText("divisional");
  await expect(page.getByTestId("import-confirm")).toContainText("Import 2");

  const { rows } = await pool.query<{ count: string }>(
    "select count(*) from goals where workspace_id = $1 and legacy_id = 'imp-1'",
    [workspaceId],
  );
  expect(Number(rows[0]?.count)).toBe(0);
});

test("acceptance: the real run matches what the preview reported", async () => {
  await page.getByTestId("import-confirm").click();
  await expect(page.getByTestId("import-done")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId("import-counts")).toContainText("Created");

  const { rows } = await pool.query<{ title: string; legacy_id: string }>(
    `select title, legacy_id from goals
      where workspace_id = $1 and legacy_type = 'csv'
      order by legacy_id`,
    [workspaceId],
  );
  expect(rows.map((row) => row.legacy_id)).toEqual(["imp-1", "imp-2"]);
  expect(rows[0]?.title).toBe("Make the import obvious");
});

test("the run list shows the preview and the import, and a re-run writes nothing new", async () => {
  await goTo(page, "/admin/imports");
  await expect(page.getByTestId("import-runs")).toContainText("Preview");
  await expect(page.getByTestId("import-runs")).toContainText("Imported");

  await upload();
  await confirmColumns();
  await page.getByTestId("import-preview").click();
  // The same file again: two rows already exist and are updated rather than
  // created a second time, which is the legacy key doing its work.
  await expect(page.getByTestId("import-counts")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("import-rows")).toContainText("Updated");

  const { rows } = await pool.query<{ count: string }>(
    "select count(*) from goals where workspace_id = $1 and legacy_type = 'csv'",
    [workspaceId],
  );
  expect(Number(rows[0]?.count)).toBe(2);
});

test("a file above the row bound is refused with the number", async () => {
  await pool.query(
    "update workspaces set settings = settings || $2::jsonb where id = $1",
    [workspaceId, JSON.stringify({ importRowLimit: 2 })],
  );

  await upload();
  await expect(page.getByTestId("import-error")).toContainText(
    "3 rows and this workspace imports at most 2",
    { timeout: 15_000 },
  );
  // Refused at the door: no mapping step, and nothing truncated to fit.
  await expect(page.getByTestId("import-columns")).toHaveCount(0);
});
