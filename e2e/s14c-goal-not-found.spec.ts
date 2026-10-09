/**
 * A goal that does not exist, or that the reader may not see, reads as not
 * found (UAT BUG-017).
 *
 * The page asked the feed and the watch control about the id before it read
 * the goal, and either refusing first sent the page to its error boundary:
 * "We could not load the goals. This is our fault".
 */
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test("acceptance: a made-up goal id reads as not found, not as our fault", async ({
  page,
}) => {
  await signIn(page);
  await goTo(page, "/goals/01a11b4b-0000-7000-8000-000000000000");
  await expect(
    page.getByText("We could not find that, or it is not yours to see."),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("This is our fault")).toHaveCount(0);
});
