/**
 * The setups one release has to keep working, in a browser (PLAN.md §5.2).
 *
 * `packages/core/test/hosting-profiles.test.ts` proves what each setup does.
 * This file proves what a person meets, and starts with the setup every
 * self-hosted instance is on: the suite builds one with every switch at its
 * default, so no cloud screen may appear, for an administrator or anybody else.
 */
import { connectionOptions, testDbEnv } from "@openokr/test-support/db";
import pg from "pg";
import { expect, test } from "./fixtures.ts";
import { goTo, INSTANCE_ACCOUNT, signIn } from "./instance-account.ts";

// The superuser: `system_settings` sits above the tenant floor, and writing it is
// instance administration, as it is in s45-operator-console.spec.ts.
const CONNECTION = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : connectionOptions(
      process.env.E2E_DATABASE ?? "openokr_e2e",
      testDbEnv.superuser,
    );

test.describe("one organisation with one workspace", () => {
  for (const route of ["/admin/plan", "/operator", "/operator/instance"]) {
    test(`${route} does not exist, even for the administrator`, async ({
      page,
    }) => {
      await signIn(page);
      await goTo(page, route);
      await expect(
        page.getByRole("heading", { level: 1, name: "Not found" }),
      ).toBeVisible({ timeout: 15_000 });
    });
  }
});

test("/workspaces/new does not exist under an invitation-only policy", async ({
  page,
}) => {
  await signIn(page);
  await goTo(page, "/workspaces/new");
  await expect(
    page.getByRole("heading", { level: 1, name: "Not found" }),
  ).toBeVisible({ timeout: 15_000 });
});

test("/api/billing/webhook does not exist with billing off", async ({
  request,
}) => {
  const answer = await request.post("/api/billing/webhook", { data: "{}" });
  expect(answer.status()).toBe(404);
});

test.describe("a group of companies", () => {
  test.describe.configure({ mode: "serial" });
  let pool: pg.Pool;

  test.beforeAll(async () => {
    pool = new pg.Pool(CONNECTION);
    await pool.query(
      `insert into system_settings (key, value, source)
       values ('cloud.enabled', 'true'::jsonb, 'admin'),
              ('registration.policy', '"invite_only"'::jsonb, 'admin')
       on conflict (key) do update set value = excluded.value`,
    );
  });

  // Undone whatever happened above, so no later spec runs against a cloud.
  test.afterAll(async () => {
    await pool.query(
      "delete from system_settings where key in ('cloud.enabled', 'registration.policy')",
    );
    await pool.end();
  });

  test("an administrator sees no plan screen and no way to start a workspace", async ({
    page,
  }) => {
    await signIn(page);
    for (const route of ["/admin/plan", "/workspaces/new"]) {
      await goTo(page, route);
      await expect(
        page.getByRole("heading", { level: 1, name: "Not found" }),
      ).toBeVisible({ timeout: 15_000 });
    }
  });
});

test.describe("a cloud run by a provider", () => {
  test.describe.configure({ mode: "serial" });

  const SETTINGS = {
    "cloud.enabled": true,
    "instance.termsUrl": "https://provider.example.com/terms",
    "instance.privacyUrl": "https://provider.example.com/privacy",
    "instance.sourceUrl": "https://git.provider.example.com/our-fork",
  };
  let pool: pg.Pool;

  test.beforeAll(async () => {
    pool = new pg.Pool(CONNECTION);
    for (const [key, value] of Object.entries(SETTINGS)) {
      await pool.query(
        `insert into system_settings (key, value, source)
         values ($1, $2::jsonb, 'admin')
         on conflict (key) do update set value = excluded.value`,
        [key, JSON.stringify(value)],
      );
    }
  });

  // Undone whatever happened above, so no later spec runs against a cloud.
  test.afterAll(async () => {
    await pool.query("delete from system_settings where key = any($1)", [
      Object.keys(SETTINGS),
    ]);
    await pool.end();
  });

  test("Stripe chosen with no keys reads as off: no checkout, and no error page", async ({
    page,
    request,
  }) => {
    await pool.query(
      `insert into system_settings (key, value, source)
       values ('billing.provider', '"stripe"'::jsonb, 'admin'),
              ('cloud.plans', $1::jsonb, 'admin')
       on conflict (key) do update set value = excluded.value`,
      [
        JSON.stringify([
          {
            key: "team",
            name: "Team",
            seats: 50,
            prices: { month: "price_does_not_exist" },
          },
        ]),
      ],
    );
    try {
      await signIn(page);
      await goTo(page, "/admin/plan");
      await expect(
        page.getByRole("heading", { level: 1, name: "Plan and seats" }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("button", { name: "Upgrade" })).toHaveCount(0);
      const answer = await request.post("/api/billing/webhook", { data: "{}" });
      expect(answer.status()).toBe(404);
    } finally {
      await pool.query(
        "delete from system_settings where key in ('billing.provider', 'cloud.plans')",
      );
    }
  });

  test("a sign-up names the provider's own legal pages", async ({ browser }) => {
    const visitor = await browser.newContext();
    const page = await visitor.newPage();
    await goTo(page, "/sign-up");
    await expect(
      page.getByRole("link", { name: "Terms of service" }),
    ).toHaveAttribute("href", SETTINGS["instance.termsUrl"]);
    await expect(
      page.getByRole("link", { name: "Privacy policy" }),
    ).toHaveAttribute("href", SETTINGS["instance.privacyUrl"]);
    await visitor.close();
  });

  /**
   * Gives each workspace a tenant row the test may change, and returns the way
   * back (plan 0.9.0 T1).
   *
   * The scheduler adopts every workspace hourly while a spec before this one
   * has the cloud flag on, so a workspace may or may not have a tenant row yet.
   * `on conflict do nothing` left an adopted row as it was and the test acted
   * on nothing. Here the missing rows are inserted, the existing ones are
   * remembered, and `restore` puts each existing row and each workspace's own
   * state back as they were and deletes only the rows this call inserted.
   */
  async function holdTenants(workspaces: readonly string[]) {
    const { rows: made } = await pool.query<{ id: string }>(
      `insert into tenants (workspace_id, region)
       select id, 'local' from unnest($1::uuid[]) as id
       on conflict (workspace_id) do nothing
       returning workspace_id as id`,
      [workspaces],
    );
    const inserted = made.map((row) => row.id);
    const existing = workspaces.filter((id) => !inserted.includes(id));
    const { rows: tenantsBefore } = await pool.query<{
      workspace_id: string;
      state: string;
      suspended_by_trial: boolean;
      closed_at: Date | null;
      owner_may_reopen: boolean;
      erasure_reminded_at: Date | null;
      deleted_at: Date | null;
      updated_at: Date;
    }>(
      `select workspace_id, state, suspended_by_trial, closed_at,
              owner_may_reopen, erasure_reminded_at, deleted_at, updated_at
         from tenants where workspace_id = any($1::uuid[])`,
      [existing],
    );
    const { rows: workspacesBefore } = await pool.query<{
      id: string;
      state: string;
    }>("select id, state from workspaces where id = any($1::uuid[])", [
      workspaces,
    ]);
    return {
      /** Every row is open, active and not closed, for a test that starts there. */
      async reset() {
        await pool.query(
          `update tenants
              set state = 'active', suspended_by_trial = false,
                  closed_at = null, owner_may_reopen = false,
                  deleted_at = null
            where workspace_id = any($1::uuid[])`,
          [workspaces],
        );
      },
      async restore() {
        await pool.query(
          "delete from tenants where workspace_id = any($1::uuid[])",
          [inserted],
        );
        for (const row of tenantsBefore) {
          await pool.query(
            `update tenants
                set state = $2, suspended_by_trial = $3, closed_at = $4,
                    owner_may_reopen = $5, erasure_reminded_at = $6,
                    deleted_at = $7, updated_at = $8
              where workspace_id = $1`,
            [
              row.workspace_id,
              row.state,
              row.suspended_by_trial,
              row.closed_at,
              row.owner_may_reopen,
              row.erasure_reminded_at,
              row.deleted_at,
              row.updated_at,
            ],
          );
        }
        // Every later spec on this shard needs the workspace taking writes,
        // which is what it was before.
        for (const row of workspacesBefore) {
          await pool.query("update workspaces set state = $2 where id = $1", [
            row.id,
            row.state,
          ]);
        }
      },
    };
  }

  test("the plan screen says when purchased credits expire", async ({
    page,
  }) => {
    // Every workspace the person is in, so whichever the session opens on has one.
    const { rows } = await pool.query<{ id: string }>(
      `select m.workspace_id as id
         from workspace_members m join users u on u.id = m.user_id
        where u.email = $1 and m.deleted_at is null`,
      [INSTANCE_ACCOUNT.email],
    );
    const workspaces = rows.map((row) => row.id);
    await pool.query(
      `insert into system_settings (key, value, source)
       values ('cloud.plans', $1::jsonb, 'admin')
       on conflict (key) do update set value = excluded.value`,
      [
        JSON.stringify([
          {
            key: "team",
            name: "Team",
            seats: 50,
            aiCredits: 2000,
            aiTopUps: true,
          },
        ]),
      ],
    );
    // A workspace may already have a tenant row: the scheduler adopts every
    // workspace hourly while a spec before this one has the cloud flag on,
    // with no plan. Left as it was, the plan carries no credits and the
    // sentence is never drawn, so the plan is set either way and put back.
    const { rows: before } = await pool.query<{
      workspace_id: string;
      plan_key: string | null;
    }>(
      "select workspace_id, plan_key from tenants where workspace_id = any($1::uuid[])",
      [workspaces],
    );
    const { rows: made } = await pool.query<{ id: string }>(
      `insert into tenants (workspace_id, plan_key, region)
       select id, 'team', 'local' from unnest($1::uuid[]) as id
       on conflict (workspace_id) do nothing
       returning workspace_id as id`,
      [workspaces],
    );
    await pool.query(
      "update tenants set plan_key = 'team' where workspace_id = any($1::uuid[])",
      [before.map((row) => row.workspace_id)],
    );
    await pool.query(
      `insert into ai_credit_packs
         (id, workspace_id, credits, purchased_usd, remaining_usd, purchase_ref,
          purchased_at, expires_at)
       select gen_random_uuid(), id, 1000, 10, 10, 'cs_e2e_' || id, now(),
              now() + interval '1 year'
         from unnest($1::uuid[]) as id`,
      [workspaces],
    );
    try {
      await signIn(page);
      await goTo(page, "/admin/plan");
      await expect(
        page.getByText(
          /1,000 purchased credits left\. 1,000 of these expire on \w+ \d{1,2}, \d{4}\./,
        ),
      ).toBeVisible({ timeout: 15_000 });
    } finally {
      await pool.query(
        "delete from ai_credit_packs where purchase_ref like 'cs_e2e_%'",
      );
      await pool.query(
        "delete from tenants where workspace_id = any($1::uuid[])",
        [made.map((row) => row.id)],
      );
      for (const row of before) {
        await pool.query(
          "update tenants set plan_key = $2 where workspace_id = $1",
          [row.workspace_id, row.plan_key],
        );
      }
      await pool.query("delete from system_settings where key = 'cloud.plans'");
    }
  });

  test("a suspension the provider set offers the administrator nothing to lift", async ({
    page,
  }) => {
    const { rows } = await pool.query<{ id: string }>(
      `select m.workspace_id as id
         from workspace_members m join users u on u.id = m.user_id
        where u.email = $1 and m.deleted_at is null`,
      [INSTANCE_ACCOUNT.email],
    );
    const workspaces = rows.map((row) => row.id);
    const held = await holdTenants(workspaces);
    // Every workspace, whether the adoption already made its tenant row or not.
    await pool.query(
      "update tenants set state = 'suspended' where workspace_id = any($1::uuid[])",
      [workspaces],
    );
    await pool.query(
      "update workspaces set state = 'read_only' where id = any($1::uuid[])",
      [workspaces],
    );
    try {
      await signIn(page);
      await goTo(page, "/admin/general");
      await expect(page.getByTestId("workspace-state-current")).toContainText(
        "Suspended by the provider",
        { timeout: 15_000 },
      );
      await expect(page.getByTestId("set-state-active")).toHaveCount(0);
      await expect(page.getByTestId("workspace-state-banner")).toContainText(
        "Only the provider can lift it.",
      );
    } finally {
      await held.restore();
    }
  });

  test("an owner closes the workspace by typing its address, sees the date, and reopens it", async ({
    page,
  }) => {
    const { rows } = await pool.query<{ id: string }>(
      `select m.workspace_id as id
         from workspace_members m join users u on u.id = m.user_id
        where u.email = $1 and m.deleted_at is null`,
      [INSTANCE_ACCOUNT.email],
    );
    const held = await holdTenants(rows.map((row) => row.id));
    await held.reset();
    await pool.query(
      `insert into system_settings (key, value, source)
       values ('cloud.closureRetentionDays', '30'::jsonb, 'admin')
       on conflict (key) do update set value = excluded.value`,
    );
    try {
      await signIn(page);
      await goTo(page, "/admin/general");
      const card = page.getByTestId("close-workspace-card");
      await expect(card).toContainText("it is deleted for good on", {
        timeout: 15_000,
      });
      const label = await card.getByText(/^Type .+ to confirm$/).innerText();
      const slug = label.replace(/^Type /, "").replace(/ to confirm$/, "");
      const submit = page.getByTestId("close-workspace-submit");
      await page.getByTestId("close-workspace-slug").fill(`${slug}-not`);
      await expect(submit).toBeDisabled();
      await page.getByTestId("close-workspace-slug").fill(slug);
      await submit.click();

      await expect(page.getByTestId("workspace-state-banner")).toContainText(
        /was closed on .+ and will be deleted on .+\. Export it before then\./,
        { timeout: 15_000 },
      );
      await page.getByTestId("reopen-workspace").click();
      await expect(page.getByTestId("workspace-state-banner")).toHaveCount(0, {
        timeout: 15_000,
      });
    } finally {
      await held.restore();
      await pool.query(
        "delete from system_settings where key = 'cloud.closureRetentionDays'",
      );
    }
  });

  test("a member starts another workspace, and lands in its setup", async ({
    page,
  }) => {
    await signIn(page);
    await goTo(page, "/workspaces/new");
    await page.getByLabel("Name", { exact: true }).fill(`Second ${Date.now()}`);
    await page.getByRole("button", { name: "Create workspace" }).click();
    await expect(page).toHaveURL(/\/welcome/, { timeout: 15_000 });
  });

  test("every member is offered the provider's own source", async ({ page }) => {
    await signIn(page);
    await goTo(page, "/");
    await page.getByRole("button", { name: /account|menu/i }).first().click();
    await expect(
      page.getByRole("menuitem", { name: "Source code" }),
    ).toHaveAttribute("href", SETTINGS["instance.sourceUrl"]);
  });
});
