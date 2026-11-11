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
