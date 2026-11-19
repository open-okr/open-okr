/**
 * Guest KPI read access (0.10.0 K4, docs/design/kpi-access.md AC-11, AC-17).
 *
 * Given a guest holding a view share on KPI-B and membership in space S holding unshared KPI-C:
 * - On /kpis (S-20), they see only KPI-B (AC-11).
 * - On /spaces/<id> (space home), the KPI section is empty (AC-17).
 */
import { connectionOptions, testDbEnv } from "@openokr/test-support/db";
import type { BrowserContext, Page } from "@playwright/test";
import pg from "pg";
import { expect, test } from "./fixtures.ts";
import { getStarted, INSTANCE_ACCOUNT } from "./instance-account.ts";

const { email: OWNER_EMAIL, password: OWNER_PASSWORD } = INSTANCE_ACCOUNT;

const GUEST_EMAIL = "kpi-guest-e2e@example.com";
const GUEST_PASSWORD = "correct-horse-battery-staple-guest";
const GUEST_NAME = "KPI Guest";

const CONNECTION = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : connectionOptions(
      process.env.E2E_DATABASE ?? "openokr_e2e",
      testDbEnv.superuser,
    );

test.describe.configure({ mode: "serial" });

let ownerContext: BrowserContext;
let ownerPage: Page;
let guestContext: BrowserContext;
let guestPage: Page;
let pool: pg.Pool;
let token: string;
let workspaceId: string;
let guestMemberId: string;
let spaceId: string;
let kpiBTitle: string;
let kpiCTitle: string;

test.beforeAll(async ({ browser }) => {
  pool = new pg.Pool(CONNECTION);
  ownerContext = await browser.newContext();
  ownerPage = await ownerContext.newPage();
  guestContext = await browser.newContext();
  guestPage = await guestContext.newPage();
});

test.afterAll(async () => {
  await pool?.end();
  await ownerContext?.close();
  await guestContext?.close();
});

test("setup: owner invites guest, creates space S, KPI-B (shared) and KPI-C in S (unshared)", async () => {
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

  // 2. Invite guest
  await expect(async () => {
    await ownerPage.goto("/admin/invitations");
    await expect(
      ownerPage.getByLabel("Email address", { exact: true }),
    ).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 30_000 });

  await ownerPage.getByLabel("Email address", { exact: true }).fill(GUEST_EMAIL);
  await ownerPage
    .getByRole("button", { name: "Create the invitation" })
    .click();

  const link = ownerPage.getByTestId("invite-link");
  await expect(link).toBeVisible({ timeout: 15_000 });
  const url = (await link.textContent())?.trim() ?? "";
  token = url.slice(url.lastIndexOf("/") + 1);
  expect(token.length).toBeGreaterThan(20);

  // 3. Guest accepts invitation
  await guestPage.goto(`/join/${token}`);
  await expect(
    guestPage.getByRole("heading", { name: /You have been invited/ }),
  ).toBeVisible({ timeout: 15_000 });
  await guestPage
    .getByRole("button", { name: "Create an account" })
    .click();

  await guestPage.getByLabel("Name").fill(GUEST_NAME);
  await guestPage.getByLabel("Email").fill(GUEST_EMAIL);
  await guestPage.getByLabel("Password", { exact: true }).fill(GUEST_PASSWORD);
  await guestPage.getByRole("button", { name: "Create account" }).click();
  await getStarted(guestPage);

  await expect(
    guestPage.getByRole("navigation", { name: "Primary" }),
  ).toBeVisible({ timeout: 20_000 });

  // 4. In database: convert member to guest (kind: 'guest', role_id: null)
  const memberRow = await pool.query<{ id: string; workspace_id: string }>(
    `select m.id, m.workspace_id
       from workspace_members m
       join users u on u.id = m.user_id
      where u.email = $1 and m.deleted_at is null`,
    [GUEST_EMAIL],
  );
  guestMemberId = memberRow.rows[0]!.id;
  workspaceId = memberRow.rows[0]!.workspace_id;

  await pool.query(
    `update workspace_members
        set kind = 'guest', role_id = null
      where id = $1`,
    [guestMemberId],
  );

  // 5. Create Space S and add guest as space member
  const stamp = Date.now().toString(36);
  spaceId = (
    await pool.query<{ id: string }>(
      `insert into spaces (id, workspace_id, name, created_at, updated_at)
       values (gen_random_uuid(), $1, $2, now(), now()) returning id`,
      [workspaceId, `Guest Space ${stamp}`],
    )
  ).rows[0]!.id;

  const spaceCtxRes = await pool.query<{ id: string }>(
    `insert into access_contexts (id, workspace_id, resource_type, resource_id, created_at, updated_at)
     values (gen_random_uuid(), $1, 'space', $2, now(), now()) returning id`,
    [workspaceId, spaceId],
  );
  const spaceContextId = spaceCtxRes.rows[0]!.id;

  await pool.query(
    `insert into space_members (id, workspace_id, space_id, member_id, role, created_at, updated_at)
     values (gen_random_uuid(), $1, $2, $3, 'member', now(), now())`,
    [workspaceId, spaceId, guestMemberId],
  );

  // 6. Create KPI-B (will be shared with guest)
  kpiBTitle = `Shared KPI ${stamp}`;
  const kpiBId = (
    await pool.query<{ id: string }>(
      `insert into kpis (
         id, workspace_id, short_id, title, indicator_type, direction,
         frequency, target_type, target_default, owner_kind, created_at, updated_at
       ) values (
         gen_random_uuid(), $1, substr(md5(random()::text), 1, 10), $2, 'leading', 'higher_better',
         'monthly', 'at_least', 100, 'workspace', now(), now()
       ) returning id`,
      [workspaceId, kpiBTitle],
    )
  ).rows[0]!.id;

  // 7. Create KPI-C in space S (unshared)
  kpiCTitle = `Space KPI ${stamp}`;
  await pool.query(
    `insert into kpis (
       id, workspace_id, short_id, title, indicator_type, direction,
       frequency, target_type, target_default, owner_kind, space_id, created_at, updated_at
     ) values (
       gen_random_uuid(), $1, substr(md5(random()::text), 1, 10), $2, 'leading', 'higher_better',
       'monthly', 'at_least', 100, 'space', $3, now(), now()
     )`,
    [workspaceId, kpiCTitle, spaceId],
  );

  // 8. Ensure KPI-B context and share binding for guest at view (10)
  const ctxRes = await pool.query<{ id: string }>(
    `insert into access_contexts (id, workspace_id, resource_type, resource_id, created_at, updated_at)
     values (gen_random_uuid(), $1, 'kpi', $2, now(), now()) returning id`,
    [workspaceId, kpiBId],
  );
  const kpiBContextId = ctxRes.rows[0]!.id;

  // Ensure guest member group
  let guestGroupRes = await pool.query<{ id: string }>(
    `select id from access_groups where workspace_id = $1 and kind = 'member' and member_id = $2 and deleted_at is null`,
    [workspaceId, guestMemberId],
  );
  let guestGroupId = guestGroupRes.rows[0]?.id;
  if (!guestGroupId) {
    guestGroupId = (
      await pool.query<{ id: string }>(
        `insert into access_groups (id, workspace_id, kind, member_id, created_at, updated_at)
         values (gen_random_uuid(), $1, 'member', $2, now(), now()) returning id`,
        [workspaceId, guestMemberId],
      )
    ).rows[0]!.id;
  }

  // Bind guest to space context (level 10: view)
  await pool.query(
    `insert into access_bindings (id, workspace_id, group_id, context_id, level, tag, created_at)
     values (gen_random_uuid(), $1, $2, $3, 10, 'share', now())`,
    [workspaceId, guestGroupId, spaceContextId],
  );

  // Bind guest to KPI-B context with tag 'share' at level 10 (view)
  await pool.query(
    `insert into access_bindings (id, workspace_id, group_id, context_id, level, tag, created_at)
     values (gen_random_uuid(), $1, $2, $3, 10, 'share', now())`,
    [workspaceId, guestGroupId, kpiBContextId],
  );
});

test("AC-11: on /kpis (S-20), guest sees KPI-B and does not see unshared KPI-C", async () => {
  await guestPage.goto("/kpis");
  await expect(guestPage.getByRole("heading", { name: "KPIs" })).toBeVisible({
    timeout: 15_000,
  });

  // KPI-B must be visible
  await expect(guestPage.getByRole("link", { name: kpiBTitle })).toBeVisible({ timeout: 10_000 });

  // Unshared KPI-C must NOT be visible
  await expect(guestPage.getByText(kpiCTitle)).toHaveCount(0);
});

test("AC-17: on /spaces/<id> (space home), guest sees an empty KPI section", async () => {
  await guestPage.goto(`/spaces/${spaceId}`);
  await expect(
    guestPage.getByRole("heading", { name: "KPI trees" }),
  ).toBeVisible({ timeout: 15_000 });

  // The KPI section must show empty state and not KPI-C
  await expect(guestPage.getByText(kpiCTitle)).toHaveCount(0);
  await expect(
    guestPage.getByText("No KPIs here that you can see."),
  ).toBeVisible({ timeout: 10_000 });
});
