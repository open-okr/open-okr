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
import { goTo, signIn } from "./instance-account.ts";

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

  test("every member is offered the provider's own source", async ({ page }) => {
    await signIn(page);
    await goTo(page, "/");
    await page.getByRole("button", { name: /account|menu/i }).first().click();
    await expect(
      page.getByRole("menuitem", { name: "Source code" }),
    ).toHaveAttribute("href", SETTINGS["instance.sourceUrl"]);
  });
});
