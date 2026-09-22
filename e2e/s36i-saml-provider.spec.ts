/**
 * Configuring a SAML provider (P8-T07c-b).
 *
 * Acceptance criterion:
 *   Given an administrator on the SSO screen, when they configure a SAML
 *   provider and hand its metadata document to the identity provider, then
 *   somebody on that provider can sign in without anybody editing the
 *   database.
 *
 * **The half that needs a browser is the configuration.** P8-T07c-a drives a
 * real assertion all the way through against a fixture identity provider in
 * `packages/core/test/saml-assertions.test.ts`, which is where the refusals
 * are, and no browser can add anything to that. What only a browser can show
 * is that a person with an administrator's access can produce a working
 * provider from a screen: before this row the form wrote OIDC columns only, so
 * a SAML provider could be created by editing the database and by no other
 * means, which is the half of the criterion that reads "without anybody
 * editing the database".
 *
 * **What the screen prints is a deliverable, not decoration.** Configuring
 * SAML is two sides of one arrangement, and the entity ID and reply URL are
 * what the identity provider asks for. They were obtainable only by reading
 * the plugin's source.
 *
 * **The metadata document is fetched after a restart, not here.** The SSO
 * plugin is mounted at boot and only when a SAML provider already exists, so
 * on this instance, which had none when the server started, the document's
 * route does not exist yet. That is the same restart the screen names for
 * every connection. It is proved over the plugin's own handler in
 * `packages/core/test/saml-surfaces.test.ts`, which parses it and reads its
 * entity id back.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;

/**
 * A real certificate, generated once for this file.
 *
 * The screen refuses a string that is not a certificate, so a placeholder
 * would prove the refusal and never the storing. Generated rather than
 * committed for the reason `packages/core/test/saml-fixture-keys.ts` gives:
 * `.gitignore` refuses `*.pem`, and a file called `idp-key.pem` in an
 * open-source checkout teaches the wrong habit whatever the key is worth.
 * Written out here rather than imported across a package boundary, because
 * this file needs one certificate and that module makes a signing pair.
 */
let certificate = "";

function generateCertificate(): string {
  const dir = mkdtempSync(join(tmpdir(), "openokr-saml-e2e-"));
  try {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-keyout",
        "key.pem",
        "-out",
        "cert.pem",
        "-days",
        "2",
        "-nodes",
        "-subj",
        "/CN=e2e-idp.test",
      ],
      { cwd: dir, stdio: "pipe" },
    );
    return readFileSync(join(dir, "cert.pem"), "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test.beforeAll(async ({ browser }) => {
  certificate = generateCertificate();

  context = await browser.newContext();
  page = await context.newPage();
  await signIn(page);
});

test.afterAll(async () => {
  await context?.close();
});

test("an incomplete SAML provider is refused, with the field named", async () => {
  await goTo(page, "/admin/sso");

  await page.getByLabel("Protocol").selectOption("saml");
  await page.getByLabel("Provider ID").fill("refused");
  await page.getByLabel("Display name").fill("Refused IdP");
  await page.getByLabel("Sign-on URL").fill("https://idp.test/sso");
  await page.getByLabel("Issuer (the provider's entity ID)").fill("https://idp.test/entity");
  // A string, not a certificate. The database constraint only asks that the
  // column is not null, so without the validator this would be stored and
  // would fail at somebody's sign-in instead.
  await page.getByLabel("Signing certificate").fill("not-a-certificate");

  await page.getByRole("button", { name: "Add provider" }).click();

  // Scoped to the form: Next.js gives every page a route announcer with
  // role=alert, so an unscoped one matches two elements and resolves neither.
  await expect(page.locator("form").getByRole("alert")).toContainText(
    "not a certificate this instance can read",
  );
  await expect(page.getByText("Refused IdP", { exact: false })).toHaveCount(0);
});

test("a complete one is stored and reads back as SAML", async () => {
  await goTo(page, "/admin/sso");

  await page.getByLabel("Protocol").selectOption("saml");
  await page.getByLabel("Provider ID").fill("acme-idp");
  await page.getByLabel("Display name").fill("Sign in with Acme");
  await page.getByLabel("Sign-on URL").fill("https://idp.test/app/sso/saml");
  await page
    .getByLabel("Issuer (the provider's entity ID)")
    .fill("https://idp.test/entity/acme");
  await page.getByLabel("Signing certificate").fill(certificate);
  await page.getByLabel("Email domains (comma-separated)").fill("acme.test");

  await page.getByRole("button", { name: "Add provider" }).click();

  await expect(page.getByRole("status")).toContainText("Provider saved");

  await goTo(page, "/admin/sso");
  const entry = page.getByRole("listitem").filter({ hasText: "Sign in with Acme" });
  await expect(entry).toContainText("SAML 2.0");
  await expect(entry).toContainText("acme.test");
});

test("the screen prints what the identity provider asks for", async () => {
  await goTo(page, "/admin/sso");

  const entry = page.getByRole("listitem").filter({ hasText: "Sign in with Acme" });
  // The entity ID is this instance, not the provider: getting those two the
  // wrong way round is the defect P8-T07c-a found by driving a real sign-in.
  await expect(entry).toContainText("Entity ID");
  await expect(entry).toContainText("Assertion consumer service");
  await expect(
    entry.getByRole("link", { name: /sso\/saml2\/sp\/metadata/ }),
  ).toBeVisible();
});
