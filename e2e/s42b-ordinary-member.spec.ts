/**
 * The product as somebody who did not create the workspace (P8-G05, P8-G05a).
 *
 * **Every other spec in this suite signs in as the founding member**, who holds
 * `full` on the workspace context. Provisioning gives everybody else `edit`. So
 * a screen that reaches for an admin-only read works in all 325 of them and
 * fails for every colleague who was invited, and that is exactly what happened:
 * eight screens refused an ordinary member on every instance ever created, and
 * nothing in this repository could see it. It was found by signing in as a demo
 * persona by hand.
 *
 * This file is the standing version of that. It invites a member through the
 * product's own invitation flow, signs in as them, and opens the screens.
 *
 * **It sets `onboardingDone` to false on purpose.** The redirect loop this also
 * guards against only exists while the workspace is unfinished: the front door
 * sent everybody to the setup screen, the setup screen refuses anybody below
 * `full` and sent them back. By the time this file runs the flag is usually
 * true, so a test that did not set it would pass without ever reaching the
 * condition it is named for.
 *
 * **Named `s42b` to sit beside `s42-route-coverage`**, its closest relative:
 * that file checks every route exists, this one checks an ordinary member can
 * open it. The name also has to sort after `registration-to-dashboard.spec.ts`,
 * which is the one spec allowed to claim the instance.
 */
import { connectionOptions, testDbEnv } from "@openokr/test-support/db";
import type { BrowserContext, Page } from "@playwright/test";
import pg from "pg";
import { expect, test } from "./fixtures.ts";
import { INSTANCE_ACCOUNT } from "./instance-account.ts";

const { email: OWNER_EMAIL, password: OWNER_PASSWORD } = INSTANCE_ACCOUNT;

const MEMBER_EMAIL = "ordinary-member@example.com";
const MEMBER_PASSWORD = "correct-horse-battery-staple-42";
const MEMBER_NAME = "Ordinary Member";

/** The error boundary every one of these screens rendered before P8-G05. */
const COULD_NOT_LOAD = /We could not load/;

const CONNECTION = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : connectionOptions(
      process.env.E2E_DATABASE ?? "openokr_e2e",
      testDbEnv.superuser,
    );

test.describe.configure({ mode: "serial" });

let owner: BrowserContext;
let ownerPage: Page;
let member: BrowserContext;
let memberPage: Page;
let pool: pg.Pool;
let token: string;

test.beforeAll(async ({ browser }) => {
  pool = new pg.Pool(CONNECTION);
  owner = await browser.newContext();
  ownerPage = await owner.newPage();
  member = await browser.newContext();
  memberPage = await member.newPage();
});

test.afterAll(async () => {
  // Left as this spec found it. A workspace stuck at `onboardingDone: false`
  // would send the founder to the setup screen in every later spec.
  await pool
    ?.query(
      `update workspaces
          set settings = jsonb_set(settings, '{onboardingDone}', 'true'::jsonb)`,
    )
    .catch(() => undefined);
  await pool?.end();
  await owner?.close();
  await member?.close();
});

test("the owner invites somebody", async () => {
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

  // Retried rather than asserted after, for the reason `s35-join` records: a
  // document navigation issued into a settling client transition is aborted.
  await expect(async () => {
    await ownerPage.goto("/admin/invitations");
    await expect(ownerPage.getByLabel("Email address")).toBeVisible({
      timeout: 5_000,
    });
  }).toPass({ timeout: 30_000 });

  await ownerPage.getByLabel("Email address").fill(MEMBER_EMAIL);
  await ownerPage
    .getByRole("button", { name: "Create the invitation" })
    .click();

  const link = ownerPage.getByTestId("invite-link");
  await expect(link).toBeVisible({ timeout: 15_000 });
  const url = (await link.textContent())?.trim() ?? "";
  token = url.slice(url.lastIndexOf("/") + 1);
  expect(token.length).toBeGreaterThan(20);
});

test("they accept it and land in the workspace", async () => {
  // Longer than the suite's default for the reason `s35-join` records: one
  // test here drives the join page, a server action that stores the token and
  // redirects, a sign-up, a registration that provisions and accepts the
  // invitation inside its own hooks, and the first render of the shell.
  test.setTimeout(120_000);

  await memberPage.goto(`/join/${token}`);
  // **The join page does not redirect, and assuming it did is what made the
  // first version of this spec time out here.** It renders the invitation and
  // waits: pressing the button is what stores the token, because Next forbids
  // a cookie write during render.
  await expect(
    memberPage.getByRole("heading", { name: /You have been invited/ }),
  ).toBeVisible({ timeout: 15_000 });
  await memberPage
    .getByRole("button", { name: "Create an account" })
    .click();

  await memberPage.getByLabel("Name").fill(MEMBER_NAME);
  await memberPage.getByLabel("Email").fill(MEMBER_EMAIL);
  await memberPage
    .getByLabel("Password", { exact: true })
    .fill(MEMBER_PASSWORD);
  await memberPage.getByRole("button", { name: "Create account" }).click();

  await expect(
    memberPage.getByRole("navigation", { name: "Primary" }),
  ).toBeVisible({ timeout: 30_000 });
});

test("they hold edit and not full, which is what makes this spec worth having", async () => {
  // Asserted rather than assumed. If provisioning ever gave an invited member
  // `full`, every screen below would pass for the wrong reason and this file
  // would quietly stop testing anything.
  const { rows } = await pool.query<{ level: number; kind: string }>(
    `select b.level, g.kind
       from access_bindings b
       join access_groups g on g.id = b.group_id
       join access_contexts c on c.id = b.context_id
       join workspace_members m on m.workspace_id = c.workspace_id
       join users u on u.id = m.user_id
      where c.resource_type = 'workspace'
        and b.deleted_at is null
        and u.email = $1
        and (g.kind = 'workspace_standard' or g.member_id = m.id)`,
    [MEMBER_EMAIL],
  );
  const levels = rows.map((row) => row.level);
  expect(levels.length).toBeGreaterThan(0);
  expect(Math.max(...levels)).toBe(70);
  expect(levels).not.toContain(100);
});

test("the front door renders for them, and does not bounce to the setup screen", async () => {
  // The loop only exists while the workspace is unfinished, so this is the
  // condition rather than an accident of whatever ran before.
  await pool.query(
    `update workspaces
        set settings = jsonb_set(settings, '{onboardingDone}', 'false'::jsonb)`,
  );

  await memberPage.goto("/");
  await expect(memberPage.getByRole("heading", { name: "Work map" })).toBeVisible(
    { timeout: 20_000 },
  );
  // Still on the front door a moment later. A client-side redirect loop leaves
  // 200s and no `Location` header, so the URL after it settles is the evidence.
  await memberPage.waitForTimeout(1_500);
  expect(new URL(memberPage.url()).pathname).toBe("/");
  await expect(memberPage.getByText(COULD_NOT_LOAD)).toHaveCount(0);
});

test("the setup screen still sends them home rather than serving them", async () => {
  await memberPage.goto("/welcome");
  await memberPage.waitForURL((url) => url.pathname === "/", {
    timeout: 20_000,
  });
});

const SCREENS = [
  ["/", "Work map"],
  ["/activity", null],
  ["/kpis", null],
  ["/goals", null],
  ["/people", null],
  ["/spaces", null],
] as const;

for (const [path] of SCREENS) {
  test(`${path} opens for an ordinary member`, async () => {
    await memberPage.goto(path);
    await expect(
      memberPage.getByRole("navigation", { name: "Primary" }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(memberPage.getByText(COULD_NOT_LOAD)).toHaveCount(0);
  });
}

test("a goal detail opens for them, which had two separate causes", async () => {
  // **The goal screen, specifically.** It failed twice over: once on the
  // settings read every one of these screens made, and again on an admin-only
  // read of the AI provider table that only this screen made.
  //
  // Reached by following a link rather than by guessing an id, so it does not
  // depend on the seed's own identifiers. **It requires a goal to exist rather
  // than skipping when none does**: a test that quietly asserts nothing when
  // the fixture changes is worse than no test, because it keeps reporting
  // green.
  await memberPage.goto("/goals");
  const link = memberPage.getByRole("link", { name: /^OBJ / }).first();
  await expect(link).toBeVisible({ timeout: 20_000 });

  await link.click();
  await memberPage.waitForURL(/\/goals\/[0-9a-f-]{20,}/, { timeout: 20_000 });
  await expect(memberPage.getByText(COULD_NOT_LOAD)).toHaveCount(0);
  await expect(
    memberPage.getByRole("heading", { name: /Key results/ }),
  ).toBeVisible({ timeout: 20_000 });
});

test("the admin section is absent for them, which is the level working", async () => {
  await memberPage.goto("/");
  await expect(
    memberPage
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Admin" }),
  ).toHaveCount(0);
});
