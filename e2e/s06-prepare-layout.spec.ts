/**
 * Phase 1's Roles and Suggested timeline, stacked (plan 0.8.0 L1).
 *
 * Side by side at half the width each, Roles stood mostly empty and the
 * timeline's Activity column was two or three words to a line. Stacked, both
 * take the full width at every size.
 */
import { expect, test } from "./fixtures.ts";

test("Roles sits above the Suggested timeline, both full width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/cycle?phase=1");
  const pair = page.getByTestId("roles-and-timeline");
  await expect(pair).toBeVisible();

  const roles = pair.getByRole("heading", { name: "Roles" });
  const timeline = pair.getByRole("heading", { name: "Suggested timeline" });
  const [rolesBox, timelineBox, pairBox] = await Promise.all([
    roles.boundingBox(),
    timeline.boundingBox(),
    pair.boundingBox(),
  ]);
  if (!rolesBox || !timelineBox || !pairBox) {
    throw new Error("the Roles and timeline cards did not render");
  }
  // Below, not beside: the timeline starts under Roles, in the same column.
  expect(timelineBox.y).toBeGreaterThan(rolesBox.y + rolesBox.height);
  expect(Math.abs(timelineBox.x - rolesBox.x)).toBeLessThan(2);

  // The Activity column now takes most of the table rather than the leftover.
  const activity = pair.getByRole("columnheader", { name: "Activity" });
  const activityBox = await activity.boundingBox();
  expect(activityBox?.width ?? 0).toBeGreaterThan(pairBox.width / 2);
});
