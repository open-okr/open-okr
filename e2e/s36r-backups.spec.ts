/**
 * Backups in workspace admin (UIUX-PLAN S-36, docs/design/backups-screen.md,
 * plan 0.7.0 U3).
 *
 * The four cards, and the one thing the screen does: take an archive, which
 * then heads the list of archives taken. Whether the list was empty before
 * depends on which specs ran first in the shard, so this spec makes its own
 * row and reads that.
 */
import { expect, test } from "./fixtures.ts";
import { goTo, INSTANCE_ACCOUNT, signIn } from "./instance-account.ts";

test("takes an archive on Backups and sees it head the list, beside the restore and instance cards", async ({
  page,
}) => {
  await signIn(page);
  await goTo(page, "/admin/backups");

  await expect(
    page.getByRole("heading", { level: 1, name: "Backups" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Archives taken" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Restoring" })).toBeVisible();
  const instance = page.locator("div", {
    has: page.getByRole("heading", { name: "This instance's backups" }),
  });
  // Self-hosted names the command; a cloud names the provider. Either way
  // no date, size or file of an instance backup is shown.
  await expect(instance.last()).toContainText(
    /\.\/openokr backup|The provider backs up the service/,
  );

  await page.getByLabel("Passphrase").first().fill("a passphrase kept safe");
  await page.getByLabel("Include files").uncheck();
  await page.getByRole("button", { name: "Export workspace" }).click();
  await expect(page.getByText(/^[0-9a-f]{64}$/).first()).toBeVisible({
    timeout: 20_000,
  });

  await page.reload();
  const history = page.getByTestId("archive-history");
  await expect(history.locator("li").first()).toContainText(
    INSTANCE_ACCOUNT.name,
    { timeout: 15_000 },
  );
  await expect(history.locator("li").first()).toContainText(/\d+ rows/);
});
