import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test("a member can choose Malay and then follow the workspace", async ({ page }) => {
  await signIn(page);
  await goTo(page, "/account");
  const language = page.getByTestId("member-language");

  await language.selectOption("ms");
  await expect(page.locator("html")).toHaveAttribute("lang", "ms");

  await language.selectOption("");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.reload();
  await expect(language).toHaveValue("");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});
