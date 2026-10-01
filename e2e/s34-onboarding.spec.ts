/**
 * Onboarding does not come back on its own, and an administrator can bring it
 * back (screen S-34, P6-G26, completeness review L-08).
 *
 * **The half `registration-to-dashboard.spec.ts` cannot prove.** That spec is
 * the one that registers, so it is the only place the wizard can be walked on
 * a first visit, and it skips all five steps there. By the time this file runs
 * the instance has been onboarded once, which is exactly the state worth
 * asserting: the wizard refuses to appear again, and refuses anybody it was
 * never for.
 *
 * Together the two cover P6-G26's test plan: skipping every step leaves a
 * working workspace, onboarding does not reappear once finished, and a second
 * owner does not see it.
 *
 * **And S-34's "a dismissed onboarding is resumable from admin"** (L-08), last
 * in the file because it opens the setup again. It finishes it again before it
 * ends, and the `afterAll` below puts the flag back even if it fails halfway:
 * a workspace left pending would send the founder to the setup screen in every
 * later spec.
 */
import { connectionOptions, testDbEnv } from "@openokr/test-support/db";
import type { BrowserContext, Page } from "@playwright/test";
import pg from "pg";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn, skipOnboarding } from "./instance-account.ts";

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

test.beforeAll(async ({ browser }) => {
  pool = new pg.Pool(CONNECTION);
  context = await browser.newContext();
  page = await context.newPage();
  await signIn(page);
});

test.afterAll(async () => {
  // Left as this spec found it, whatever happened above. The last test
  // finishes the setup it reopened; this is for when it did not get there.
  await pool
    ?.query(
      `update workspaces
          set settings = jsonb_set(settings, '{onboardingDone}', 'true'::jsonb)`,
    )
    .catch(() => undefined);
  await pool?.end();
  await context?.close();
});

test("the front door no longer diverts, because the workspace is set up", async () => {
  await goTo(page, "/");
  expect(new URL(page.url()).pathname).toBe("/");
  await expect(
    page.getByRole("heading", { level: 1, name: "Work map" }),
  ).toBeVisible({ timeout: 15_000 });
});

test("asking for it directly is refused, rather than shown again", async () => {
  // A redirect, not an empty state: there is no version of this screen that is
  // useful to somebody whose workspace is already set up.
  //
  // **Awaited rather than read** (P8-G01). This read `page.url()` straight
  // after the navigation and passed for as long as `welcome` had no loading
  // state. A `loading.tsx` makes Next stream the segment, so `page.goto`
  // returns once the fallback is painted, which is before the redirect has
  // happened, and a plain value assertion has no retry to wait it out.
  // `toHaveURL` does, and the fixture's own settling only wraps matchers, so
  // the assertion had to become one.
  await goTo(page, "/welcome");
  // Anchored on the whole url rather than on a trailing slash, which
  // `/welcome/` would also satisfy: host, then nothing but the root.
  await expect(page).toHaveURL(/^https?:\/\/[^/]+\/$/, { timeout: 15_000 });
  await expect(page.getByTestId("welcome-progress")).toHaveCount(0);
});

test("skipping every step left the documented defaults in place", async () => {
  // The acceptance line's second half. The wizard was skipped five times in
  // `registration-to-dashboard`, so what the workspace holds now is what
  // provisioning resolved: §4.14's defaults, not blanks.
  await goTo(page, "/admin/general");
  await expect(page.getByLabel("Timezone")).not.toHaveValue("", {
    timeout: 15_000,
  });
  await goTo(page, "/admin/rhythm");
  // The frequency reads back as METHOD.md's own default rather than as blank,
  // which is the half of §4.14 this criterion is about: skipping a question
  // keeps the documented answer, it does not leave a hole.
  await expect(page.getByText("Check-in frequency")).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.locator('select[name="defaultCheckInFrequency"]'),
  ).toHaveValue("weekly");
});

test("an administrator opens the setup again from General, and every answer is kept", async () => {
  // S-34: "A dismissed onboarding is resumable from admin" (L-08). It was
  // not: once finished, the wizard sent everybody home and nothing could
  // change its mind.
  await goTo(page, "/admin/general");
  await expect(page.getByTestId("setup-state")).toContainText("Finished", {
    timeout: 15_000,
  });
  const timezone = await page.getByLabel("Timezone").inputValue();

  await page.getByTestId("reopen-onboarding").click();
  await expect(page).toHaveURL(/\/welcome$/, { timeout: 15_000 });
  // Arrival waited out, for the reason `skipOnboarding` gives: the wizard is
  // briefly mounted twice as the navigation settles.
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("welcome-skip")).toHaveCount(1, {
    timeout: 15_000,
  });

  // The wizard opens on what the workspace holds now, not on blanks or on
  // the defaults, which is what makes reopening it safe.
  await expect(
    page.getByLabel("What is this workspace called?"),
  ).not.toHaveValue("", { timeout: 15_000 });
  await expect(page.getByLabel("Which clock does it keep?")).toHaveValue(
    timezone,
  );

  // While it is open, the front door sends an administrator to it, and
  // General offers the way back in rather than a second reopen.
  await goTo(page, "/");
  await expect(page).toHaveURL(/\/welcome$/, { timeout: 15_000 });
  await goTo(page, "/admin/general");
  await expect(page.getByTestId("continue-onboarding")).toBeVisible({
    timeout: 15_000,
  });
  await page.getByTestId("continue-onboarding").click();

  // Skipping every step finishes it again and changes nothing.
  await skipOnboarding(page);
  await expect(page).toHaveURL(/^https?:\/\/[^/]+\/$/, { timeout: 15_000 });

  await goTo(page, "/admin/general");
  await expect(page.getByTestId("setup-state")).toContainText("Finished", {
    timeout: 15_000,
  });
  await expect(page.getByLabel("Timezone")).toHaveValue(timezone);
  await goTo(page, "/admin/rhythm");
  await expect(
    page.locator('select[name="defaultCheckInFrequency"]'),
  ).toHaveValue("weekly", { timeout: 15_000 });
});
