/**
 * A workspace archive, sealed under a passphrase (completeness review H-18).
 *
 * The export card called `workspace.exportArchive` with no key ring and no
 * storage in its context, so on a running instance it could never seal an
 * archive; and an archive sealed under an instance's root key could not be
 * opened anywhere else. This drives the card the way an administrator moving
 * a workspace would: export under a passphrase, download the file, and preview
 * importing it, which a wrong passphrase refuses and the right one opens.
 *
 * The preview is a dry run, so the shared workspace this suite runs in is not
 * changed by it.
 */
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

const PASSPHRASE = "a passphrase for moving house";

test("exports under a passphrase, and only that passphrase previews the import", async ({
  page,
}) => {
  await signIn(page);
  await goTo(page, "/admin/imports");

  const exportCard = page.locator("div", {
    has: page.getByRole("heading", { name: "Export workspace" }),
  });
  const exportButton = page.getByRole("button", { name: "Export workspace" });
  await expect(exportButton).toBeDisabled();
  await page.getByLabel("Passphrase").first().fill(PASSPHRASE);
  await page.getByLabel("Include files").uncheck();
  await exportButton.click();
  await expect(exportCard.getByText(/^[0-9a-f]{64}$/).first()).toBeVisible({
    timeout: 20_000,
  });

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download" }).click(),
  ]);
  const archive = await download.path();

  const importPassphrase = page.getByLabel("Passphrase").last();
  const file = page.locator('input[type="file"][accept=".okr"]');

  await importPassphrase.fill("not the passphrase it was sealed with");
  await file.setInputFiles(archive);
  await expect(
    page.getByText("That passphrase does not open this archive"),
  ).toBeVisible({ timeout: 20_000 });

  await importPassphrase.fill(PASSPHRASE);
  await file.setInputFiles(archive);
  await expect(page.getByText("Rows to create")).toBeVisible({
    timeout: 20_000,
  });
});
