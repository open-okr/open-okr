/**
 * The organisation-mandated second factor (P8-T09).
 *
 * Acceptance criterion:
 *   Given the policy enabled, when an unenrolled member signs in, then they
 *   are locked into enrolment before reaching any other screen.
 *
 * "Before reaching any other screen" is a claim about every screen, and the
 * only way to show it is to open one and watch where the browser ends up. The
 * decision itself, and who is exempt, is proved in
 * `packages/core/test/second-factor-policy.test.ts`.
 *
 * **This spec turns the policy off again in `afterAll`**, whatever happened in
 * between. It is a workspace-wide setting on the one instance the suite
 * builds, and leaving it on would hold every spec that runs after it.
 */
import { createHmac } from "node:crypto";
import type { BrowserContext, Page } from "@playwright/test";
import { connectionOptions, testDbEnv } from "@openokr/test-support/db";
import pg from "pg";
import { expect, test } from "./fixtures.ts";
import { goTo, INSTANCE_ACCOUNT, signIn } from "./instance-account.ts";

/**
 * The database this server owns, named the way `prepare-database.ts` names it.
 *
 * **Repeated rather than imported, and not out of laziness.** That module ends
 * in a top-level `await prepareDatabase()`: it is a script as well as a
 * module, so importing it for one constant drops and rebuilds the database in
 * the middle of the run. It did exactly that on 17 September 2026, and the
 * symptom was every spec after this one failing to sign in, because the
 * account that had claimed the instance no longer existed.
 */
const E2E_DATABASE = process.env.E2E_DATABASE_NAME ?? "openokr_e2e";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;

const POLICY_LABEL = "Require a second factor for everybody in this workspace";

/**
 * A real one-time code (RFC 6238) from the secret the screen shows.
 *
 * The same arithmetic `packages/core/test/auth.test.ts` uses. There is no
 * authenticator app in a browser under test, so the spec is the app.
 */
function totp(base32Secret: string, atMs = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of base32Secret.replace(/=+$/, "").toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index === -1) continue;
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = Buffer.from(
    (bits.match(/.{8}/g) ?? []).map((byte) => Number.parseInt(byte, 2)),
  );

  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 1000 / 30)));
  const digest = createHmac("sha1", bytes).update(counter).digest();
  const offset = (digest[digest.length - 1] as number) & 0x0f;
  const binary =
    ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000)
      .toString()
      .padStart(6, "0");
  return binary;
}

async function setPolicy(on: boolean): Promise<void> {
  await goTo(page, "/admin/general");
  const box = page.getByLabel(POLICY_LABEL);
  if ((await box.isChecked()) !== on) {
    await box.setChecked(on);
  }
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForLoadState("networkidle");
}

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
  await signIn(page);
});

test.afterAll(async () => {
  // **Handed back exactly as it was found, through the database rather than
  // through the product.**
  //
  // This spec does two things to the one instance the suite builds: it turns
  // on a workspace-wide policy, and it enrols a real second factor on the
  // account every other spec signs in with. An enrolled account answers a
  // password sign-in with a challenge instead of a session, so leaving either
  // behind fails every spec that sorts after this one, and the failure reads
  // as a sign-in bug rather than as this file's litter. It did exactly that
  // on 17 September 2026: thirty-one specs failed with "nobody has claimed
  // this instance".
  //
  // The cleanup is deliberately not driven through the screens. A spec that
  // failed half way can leave the browser held at enrolment, which is the one
  // state that cannot reach the admin screen the policy is turned off from,
  // so a teardown that needs that screen is a teardown that fails when it is
  // needed most. Two statements on the same database the harness built cannot
  // fail that way.
  const client = new pg.Client(
    connectionOptions(E2E_DATABASE, testDbEnv.superuser),
  );
  try {
    await client.connect();
    await client.query(
      "update workspaces set settings = settings - 'requireSecondFactor'",
    );
    await client.query("delete from two_factors");
    await client.query("update users set two_factor_enabled = false");
  } finally {
    await client.end().catch(() => undefined);
    await context?.close();
  }
});

test("the policy is off until somebody asks for it", async () => {
  await goTo(page, "/admin/general");
  await expect(page.getByLabel(POLICY_LABEL)).not.toBeChecked();

  // And nothing holds anybody meanwhile.
  await goTo(page, "/goals");
  expect(new URL(page.url()).pathname).toBe("/goals");
});

test("switching it on holds an unenrolled member at enrolment", async () => {
  await setPolicy(true);

  await goTo(page, "/goals");
  expect(new URL(page.url()).pathname).toBe("/account/security");

  // Every screen, not the one that happened to be tried. Including admin,
  // which is what makes this a policy rather than a suggestion: the person
  // who switched it on is held by it too.
  for (const screen of ["/", "/people", "/admin/general"]) {
    await goTo(page, screen);
    expect(new URL(page.url()).pathname).toBe("/account/security");
  }
});

test("enrolling a factor lets them back in", async () => {
  await goTo(page, "/account/security");

  await page.getByLabel("Confirm your password").fill(INSTANCE_ACCOUNT.password);
  await page.getByRole("button", { name: "Set up one-time codes" }).click();

  const uri = page.locator("code").filter({ hasText: "otpauth://" }).first();
  await expect(uri).toBeVisible({ timeout: 15_000 });
  const secret = new URL(
    ((await uri.textContent()) ?? "").trim(),
  ).searchParams.get("secret") as string;
  expect(secret).toBeTruthy();

  await page.getByLabel("Code from your app").fill(totp(secret));
  await page.getByRole("button", { name: "Turn on" }).click();
  await expect(page.getByRole("status")).toContainText("One-time codes are on", {
    timeout: 15_000,
  });

  // The hold is lifted on the next page load, because it reads the session's
  // own flag rather than a cached answer.
  await goTo(page, "/goals");
  expect(new URL(page.url()).pathname).toBe("/goals");
});
