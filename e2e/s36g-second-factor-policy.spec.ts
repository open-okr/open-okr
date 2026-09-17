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
import { expect, test } from "./fixtures.ts";
import { goTo, INSTANCE_ACCOUNT, signIn } from "./instance-account.ts";

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
  // Whatever happened above, the instance is handed back with the policy off.
  try {
    await setPolicy(false);
  } finally {
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
