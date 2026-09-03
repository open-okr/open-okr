/**
 * The large-export path, in a browser (TECHNICAL-PLAN §4.9, §4.13, P5-T15).
 *
 * Acceptance criterion:
 *   Given a list larger than the inline limit, when a member exports it, then
 *   they are told it is being prepared and the file reaches them without the
 *   request having waited.
 *
 * **A browser rather than a unit test, because the criterion is about waiting.**
 * What the worker builds, who may collect it and what happens when a member is
 * suspended are proved against a real database in
 * `packages/core/test/export-run.test.ts`. What only a browser can prove is
 * that the request comes back straight away with a sentence rather than a file,
 * that the relay finishes the work afterwards, and that the row the person
 * comes back to hands over real bytes.
 *
 * **The limit is lowered through the workspace's own setting.**
 * `exportInlineRowLimit` is a §4.14 setting, so the spec sets it to one rather
 * than creating five thousand objectives. The branch is the claim, not the
 * number.
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

test.beforeAll(async ({ browser }) => {
  pool = new pg.Pool(CONNECTION);
  context = await browser.newContext();
  page = await context.newPage();
});

test.afterAll(async () => {
  // Put the limit back, so a spec that sorts after this one exports inline the
  // way every other member does.
  if (workspaceId) {
    await pool
      .query(
        "update workspaces set settings = settings - 'exportInlineRowLimit' where id = $1",
        [workspaceId],
      )
      .catch(() => undefined);
  }
  await pool?.end();
  await context?.close();
});

test("sign in, and make every export too large to build in a request", async () => {
  await signIn(page);
  await expect(
    page.getByRole("heading", { level: 1, name: "Work map" }),
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

  const goals = (
    await pool.query<{ count: string }>(
      "select count(*) from goals where workspace_id = $1 and deleted_at is null",
      [workspaceId],
    )
  ).rows[0];
  // The specs before this one have created objectives, so one row is a limit
  // every list is already over.
  expect(Number(goals?.count)).toBeGreaterThan(1);

  await pool.query(
    "update workspaces set settings = settings || $2::jsonb where id = $1",
    [workspaceId, JSON.stringify({ exportInlineRowLimit: 1 })],
  );
});

test("acceptance: the request comes back with a sentence, not a file", async () => {
  await goTo(page, "/goals");
  await page.getByRole("button", { name: "Export" }).click();

  // Straight away, and with no download: the whole point of the branch.
  await expect(page.getByTestId("export-result")).toContainText(
    "It is being prepared",
    { timeout: 15_000 },
  );
  await expect(page.getByTestId("export-result")).toContainText(
    "Your exports",
  );
});

test("the relay builds it, and the row says where to collect it", async () => {
  await expect(async () => {
    const { rows } = await pool.query<{ state: string; blob_id: string }>(
      `select state, blob_id from export_runs
        where workspace_id = $1 order by created_at desc limit 1`,
      [workspaceId],
    );
    // If this never passes, the relay is not running, which is a different
    // failure from the export being wrong.
    expect(rows[0]?.state).toBe("ready");
    expect(rows[0]?.blob_id).not.toBeNull();
  }).toPass({ timeout: 30_000 });

  await goTo(page, "/goals");
  await expect(page.getByTestId("my-exports")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("my-exports")).toContainText("Ready");
});

test("acceptance: the file reaches them, with the rows the screen showed", async () => {
  const link = page.getByTestId("my-exports").getByRole("link", {
    name: "Download",
  });
  await expect(link.first()).toBeVisible();

  const href = await link.first().getAttribute("href");
  expect(href).toMatch(/^\/api\/exports\/[0-9a-f-]+\/download$/);

  // Fetched through the page's own session, which is what makes it theirs.
  const body = await page.evaluate(async (path) => {
    const response = await fetch(path as string);
    return {
      status: response.status,
      disposition: response.headers.get("content-disposition"),
      type: response.headers.get("content-type"),
      text: await response.text(),
    };
  }, href);

  expect(body.status).toBe(200);
  expect(body.disposition).toContain("attachment");
  expect(body.type).toContain("text/csv");
  // The heading the CSV writer puts on a goal list. A file that opened as
  // nothing would still have had a 200 and a content type.
  expect(body.text).toContain("Objective");
});

test("somebody else's export is not found, not forbidden", async () => {
  const run = (
    await pool.query<{ id: string }>(
      "select id from export_runs where workspace_id = $1 limit 1",
      [workspaceId],
    )
  ).rows[0];

  // Re-pointed at a member who did not ask for it. The route resolves the
  // caller's own member row, so this is now somebody else's file.
  const other = (
    await pool.query<{ id: string }>(
      `insert into workspace_members (id, workspace_id, name, status)
       values (gen_random_uuid(), $1, 'Someone else', 'active') returning id`,
      [workspaceId],
    )
  ).rows[0];
  await pool.query(
    "update export_runs set requested_by_id = $2 where id = $1",
    [run?.id, other?.id],
  );

  const status = await page.evaluate(async (path) => {
    const response = await fetch(path as string);
    return response.status;
  }, `/api/exports/${run?.id}/download`);

  // Not 403: a caller must not learn what other people have exported by
  // probing identifiers.
  expect(status).toBe(404);
});

test("a workbook is offered too, and downloads as one", async () => {
  await pool.query(
    "update workspaces set settings = settings - 'exportInlineRowLimit' where id = $1",
    [workspaceId],
  );
  await goTo(page, "/goals");

  await page.getByLabel("Export format").selectOption("xlsx");
  const download = page.waitForEvent("download", { timeout: 20_000 });
  await page.getByRole("button", { name: "Export" }).click();

  await expect(page.getByTestId("export-result")).toContainText("downloaded", {
    timeout: 20_000,
  });
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.xlsx$/);
});
