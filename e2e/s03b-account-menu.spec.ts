/**
 * The avatar menu says who is signed in (plan 0.8.0 Y1).
 *
 * Its circle drew the workspace's initials, and nothing in the menu named the
 * person, their sign-in email or their role.
 */
import { expect, test } from "./fixtures.ts";
import { INSTANCE_ACCOUNT, signIn } from "./instance-account.ts";

test("the menu names the person, their email and their role, and leads to Your account", async ({
  page,
}) => {
  await signIn(page);
  const trigger = page.getByTestId("account-menu");
  await expect(trigger).toHaveAccessibleName(
    new RegExp(`^Account menu for ${INSTANCE_ACCOUNT.name}, `),
  );
  await trigger.click();

  const header = page.getByTestId("account-menu-header");
  await expect(header).toContainText(INSTANCE_ACCOUNT.name);
  await expect(header).toContainText(INSTANCE_ACCOUNT.email);
  // The instance account set the workspace up, so it holds the Owner role.
  await expect(header).toContainText("Owner");

  await header.click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Your account" }),
  ).toBeVisible();
});

// Q-10a (0.8.0 acceptance test): "Sign out" was a plain button inside the
// menu, so the arrow keys went past it and only Tab found it.
test("the arrow keys reach Sign out, and Enter signs out", async ({ page }) => {
  await signIn(page);
  await page.getByTestId("account-menu").focus();
  await page.keyboard.press("Enter");

  const signOut = page.getByRole("menuitem", { name: "Sign out" });
  await expect(signOut).toBeVisible();
  // Down through the rows until Sign out holds the focus. A row the arrow
  // keys skip would never get there.
  for (let step = 0; step < 12; step += 1) {
    if (await signOut.evaluate((item) => item === document.activeElement)) {
      break;
    }
    await page.keyboard.press("ArrowDown");
  }
  await expect(signOut).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/sign-in/);
});
