/**
 * KPI sharing end-to-end (0.10.0 K7, docs/design/kpi-access.md AC-9, S-21).
 *
 * Owner shares a KPI with a Viewer at edit, then the Viewer records a reading
 * on that KPI and succeeds, while recording on an unshared KPI is refused.
 */
import { connectionOptions, testDbEnv } from "@openokr/test-support/db";
import type { BrowserContext, Page } from "@playwright/test";
import pg from "pg";
import { expect, test } from "./fixtures.ts";
import { getStarted, INSTANCE_ACCOUNT } from "./instance-account.ts";
import { choose } from "./pickers.ts";

const { email: OWNER_EMAIL, password: OWNER_PASSWORD } = INSTANCE_ACCOUNT;

const VIEWER_EMAIL = "kpi-viewer-e2e@example.com";
const VIEWER_PASSWORD = "correct-horse-battery-staple-viewer";
const VIEWER_NAME = "KPI Viewer";

const CONNECTION = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : connectionOptions(
      process.env.E2E_DATABASE ?? "openokr_e2e",
      testDbEnv.superuser,
    );

test.describe.configure({ mode: "serial" });

let ownerContext: BrowserContext;
let ownerPage: Page;
let viewerContext: BrowserContext;
let viewerPage: Page;
let pool: pg.Pool;
let workspaceId: string;
let viewerMemberId: string;
let kpiId: string;
let kpiTitle: string;
let kpiBId: string;
let kpiBTitle: string;

test.beforeAll(async ({ browser }) => {
  pool = new pg.Pool(CONNECTION);
  ownerContext = await browser.newContext();
  ownerPage = await ownerContext.newPage();
  viewerContext = await browser.newContext();
  viewerPage = await viewerContext.newPage();
});

test.afterAll(async () => {
  await pool?.end();
  await ownerContext?.close();
  await viewerContext?.close();
});

test("setup: owner invites viewer and creates KPI-A and KPI-B", async () => {
  test.setTimeout(120_000);

  // 1. Sign in as owner
  await ownerPage.goto("/");
  if (ownerPage.url().includes("/sign-in")) {
    await ownerPage.getByLabel("Email").fill(OWNER_EMAIL);
    await ownerPage.getByLabel("Password").fill(OWNER_PASSWORD);
    await ownerPage
      .getByRole("button", { name: "Sign in", exact: true })
      .first()
      .click();
  }
  await expect(
    ownerPage.getByRole("navigation", { name: "Primary" }),
  ).toBeVisible({ timeout: 15_000 });

  // 2. Invite viewer
  await expect(async () => {
    await ownerPage.goto("/admin/invitations");
    await expect(
      ownerPage.getByLabel("Email address", { exact: true }),
    ).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 30_000 });

  await ownerPage.getByLabel("Email address", { exact: true }).fill(VIEWER_EMAIL);
  await ownerPage
    .getByRole("button", { name: "Create the invitation" })
    .click();

  const link = ownerPage.getByTestId("invite-link");
  await expect(link).toBeVisible({ timeout: 15_000 });
  const url = (await link.textContent())?.trim() ?? "";
  const token = url.slice(url.lastIndexOf("/") + 1);
  expect(token.length).toBeGreaterThan(20);

  // 3. Viewer accepts invitation
  await viewerPage.goto(`/join/${token}`);
  await expect(
    viewerPage.getByRole("heading", { name: /You have been invited/ }),
  ).toBeVisible({ timeout: 15_000 });
  await viewerPage
    .getByRole("button", { name: "Create an account" })
    .click();

  await viewerPage.getByLabel("Name").fill(VIEWER_NAME);
  await viewerPage.getByLabel("Email").fill(VIEWER_EMAIL);
  await viewerPage.getByLabel("Password", { exact: true }).fill(VIEWER_PASSWORD);
  await viewerPage.getByRole("button", { name: "Create account" }).click();
  await getStarted(viewerPage);

  await expect(
    viewerPage.getByRole("navigation", { name: "Primary" }),
  ).toBeVisible({ timeout: 20_000 });

  // 4. Set viewer member role to 'viewer'
  const memberRow = await pool.query<{ id: string; workspace_id: string }>(
    `select m.id, m.workspace_id
       from workspace_members m
       join users u on u.id = m.user_id
      where u.email = $1 and m.deleted_at is null`,
    [VIEWER_EMAIL],
  );
  viewerMemberId = memberRow.rows[0]!.id;
  workspaceId = memberRow.rows[0]!.workspace_id;

  await pool.query(
    `update workspace_members set role_id = (
       select id from workspace_roles where workspace_id = $1 and builtin_key = 'viewer' and deleted_at is null
     ) where id = $2`,
    [workspaceId, viewerMemberId],
  );

  // 5. Find owner member id
  const ownerMemberRes = await pool.query<{ id: string }>(
    `SELECT m.id FROM workspace_members m
      WHERE m.workspace_id = $1
        AND m.role_id = (select id from workspace_roles where workspace_id = $1 and builtin_key = 'owner' and deleted_at is null)
      LIMIT 1`,
    [workspaceId],
  );
  const ownerMemberId = ownerMemberRes.rows[0].id;

  // 6. Create KPI-A (to be shared)
  const stamp = Date.now().toString(36);
  kpiTitle = `Shared KPI ${stamp}`;
  const kpiRes = await pool.query<{ id: string }>(
    `INSERT INTO kpis (
       id, workspace_id, short_id, title, indicator_type, direction,
       frequency, target_type, target_default, owner_kind, owner_member_id, created_at, updated_at
     ) VALUES (
       gen_random_uuid(), $1, substr(md5(random()::text), 1, 10), $2, 'lagging', 'higher_better',
       'monthly', 'at_least', 100, 'workspace', $3, now(), now()
     ) RETURNING id`,
    [workspaceId, kpiTitle, ownerMemberId],
  );
  kpiId = kpiRes.rows[0].id;

  // 7. Create KPI-B (unshared)
  kpiBTitle = `Unshared KPI ${stamp}`;
  const kpiBRes = await pool.query<{ id: string }>(
    `INSERT INTO kpis (
       id, workspace_id, short_id, title, indicator_type, direction,
       frequency, target_type, target_default, owner_kind, owner_member_id, created_at, updated_at
     ) VALUES (
       gen_random_uuid(), $1, substr(md5(random()::text), 1, 10), $2, 'lagging', 'higher_better',
       'monthly', 'at_least', 100, 'workspace', $3, now(), now()
     ) RETURNING id`,
    [workspaceId, kpiBTitle, ownerMemberId],
  );
  kpiBId = kpiBRes.rows[0].id;

  // 8. Create access contexts and bindings
  for (const id of [kpiId, kpiBId]) {
    const ctxRes = await pool.query<{ id: string }>(
      `INSERT INTO access_contexts (id, workspace_id, resource_type, resource_id, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, 'kpi', $2, now(), now())
       RETURNING id`,
      [workspaceId, id],
    );
    const contextId = ctxRes.rows[0].id;

    // Bind workspace standard at 10
    const stdGroupRes = await pool.query<{ id: string }>(
      `SELECT id FROM access_groups WHERE workspace_id = $1 AND kind = 'workspace_standard' and deleted_at is null LIMIT 1`,
      [workspaceId],
    );
    if (stdGroupRes.rows[0]) {
      await pool.query(
        `INSERT INTO access_bindings (id, workspace_id, group_id, context_id, level, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, 10, now())
         ON CONFLICT DO NOTHING`,
        [workspaceId, stdGroupRes.rows[0].id, contextId],
      );
    }

    // Bind owner at 100 tag owner
    const ownerGroupRes = await pool.query<{ id: string }>(
      `SELECT id FROM access_groups WHERE workspace_id = $1 AND kind = 'member' AND member_id = $2 and deleted_at is null`,
      [workspaceId, ownerMemberId],
    );
    let ownerGroupId = ownerGroupRes.rows[0]?.id;
    if (!ownerGroupId) {
      const gRes = await pool.query<{ id: string }>(
        `INSERT INTO access_groups (id, workspace_id, kind, member_id, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, 'member', $2, now(), now()) RETURNING id`,
        [workspaceId, ownerMemberId],
      );
      ownerGroupId = gRes.rows[0].id;
    }
    await pool.query(
      `INSERT INTO access_bindings (id, workspace_id, group_id, context_id, level, tag, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, 100, 'owner', now())
       ON CONFLICT DO NOTHING`,
      [workspaceId, ownerGroupId, contextId],
    );
  }
});

test("owner opens KPI page and shares with Viewer at edit", async () => {
  await ownerPage.goto(`/kpis/${kpiId}`);
  await expect(ownerPage.getByRole("heading", { name: kpiTitle })).toBeVisible({
    timeout: 15_000,
  });

  // Open share panel / form
  const shareButton = ownerPage.getByTestId("open-share-panel");
  await expect(shareButton).toBeVisible();
  await shareButton.click();

  // Select viewer member and edit level
  const pickerLocator = ownerPage.locator("#share-member-picker");
  await choose(pickerLocator, VIEWER_NAME);

  const levelSelect = ownerPage.locator("select#share-level-input");
  await levelSelect.selectOption("edit");

  await ownerPage.getByRole("button", { name: "Save share" }).click();

  // Verify share row appears with Edit
  const shareRow = ownerPage.getByTestId(`share-row-${viewerMemberId}`);
  await expect(shareRow).toBeVisible({ timeout: 15_000 });
});

test("viewer signs in, opens KPI grid, records on KPI-A and is refused on KPI-B (AC-9)", async () => {
  // Open KPI grid
  await viewerPage.goto("/kpis");
  await expect(viewerPage.getByRole("link", { name: kpiTitle, exact: true })).toBeVisible({ timeout: 15_000 });

  // KPI-A is editable by Viewer (has edit share)
  const cellA = viewerPage.locator(`[id^="cell-${kpiId}-"]`).first();
  await expect(cellA).toBeVisible({ timeout: 15_000 });
  await cellA.fill("42");
  await cellA.press("Enter");

  // Verify DB recorded the value for KPI-A
  await expect.poll(async () => {
    const res = await pool.query<{ actual_value: string }>(
      `SELECT actual_value FROM kpi_records WHERE kpi_id = $1 LIMIT 1`,
      [kpiId],
    );
    return res.rows[0]?.actual_value ? Number(res.rows[0].actual_value) : null;
  }, { timeout: 15_000 }).toBe(42);

  // KPI-B has no edit share, so its cells are not editable inputs
  const cellB = viewerPage.locator(`[id^="cell-${kpiBId}-"]`).first();
  await expect(cellB).toHaveCount(0);
});
