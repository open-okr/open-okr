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
    const { rows: made } = await pool.query<{ id: string }>(
      `insert into tenants (workspace_id, plan_key, region)
       select id, 'team', 'local' from unnest($1::uuid[]) as id
       on conflict (workspace_id) do nothing
       returning workspace_id as id`,
      [workspaces],
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
    const { rows: made } = await pool.query<{ id: string }>(
      `insert into tenants (workspace_id, state, region)
       select id, 'suspended', 'local' from unnest($1::uuid[]) as id
       on conflict (workspace_id) do nothing
       returning workspace_id as id`,
      [workspaces],
    );
    const suspended = made.map((row) => row.id);
    await pool.query(
      "update workspaces set state = 'read_only' where id = any($1::uuid[])",
      [suspended],
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
      // Every later spec on this shard needs the workspace taking writes.
      await pool.query(
        "update workspaces set state = 'active' where id = any($1::uuid[])",
        [suspended],
      );
      await pool.query(
        "delete from tenants where workspace_id = any($1::uuid[])",
        [suspended],
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
