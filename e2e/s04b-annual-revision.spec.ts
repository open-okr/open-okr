/**
 * Revising the agreed annual frame mid-year, with a reason (P9-T13-c-c,
 * METHOD.md §2.1, NW-Q2-22).
 *
 * Acceptance:
 *   Given a not-doing item removed with a reason, then the frame's history
 *   shows the removal and its reason.
 *
 * The annual target half of NW-Q2-22 is proved in `annual-revisions.test.ts`
 * and, for the close, by `s24d-target-rule.spec.ts`.
 *
 * **It sorts after `s04-annual-cycle.spec.ts`**, which opens the annual
 * cycle this reads phase 0 of. No other spec reads the frame, and each run
 * stamps its own not-doing items, so a retry sets the frame up again rather
 * than finding the last run's.
 */
import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

const STAMP = Date.now().toString(36);
const PRICING = `No pricing rebuild before July ${STAMP}`;
const REGIONS = `No new regions this year ${STAMP}`;
const REASON = `Competitive price point; the pricing review starts in Q3 ${STAMP}`;

const doc = (lines: readonly string[]) => ({
  type: "doc",
  content: lines.map((line) => ({
    type: "paragraph",
    content: [{ type: "text", text: line }],
  })),
});

test("acceptance: a not-doing item removed from the agreed frame keeps its reason in the frame's history", async ({
  page,
  playwright,
  baseURL,
}) => {
  await signIn(page);
  await goTo(page, "/account/api-tokens");
  await page.getByLabel("Name").fill("Annual revision e2e");
  await page.getByRole("checkbox", { name: "Write" }).check();
  await page.getByRole("button", { name: "Create token" }).click();
  const shown = page.getByTestId("minted-token");
  await expect(shown).toBeVisible({ timeout: 10_000 });
  const token = ((await shown.textContent()) ?? "").trim();
  const api: APIRequestContext = await playwright.request.newContext({
    baseURL,
  });
  const headers = { authorization: `Bearer ${token}` };

  // The year's frame, agreed, with two things not being done. If a frame is
  // already agreed this is itself a revision, so it carries a reason too.
  const current = (await (
    await api.get("/api/v1/frame/read", { headers })
  ).json()).data as { yearLabel: string } | null;
  const setUp = await api.post("/api/v1/frame/set", {
    headers,
    data: {
      yearLabel: current?.yearLabel ?? String(new Date().getUTCFullYear()),
      agreed: true,
      notDoing: doc([PRICING, REGIONS]),
      strategies: [{ text: "Win mid-market on time to value" }],
      reason: `Set up for the revision spec ${STAMP}`,
    },
  });
  expect(setUp.status(), await setUp.text()).toBe(200);
  await api.dispose();

  await goTo(page, "/cycle?mode=annual");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Phase 0 · Annual strategy",
    { timeout: 15_000 },
  );
  // The compact editor (guided-inputs §4.7), opened on the stored document:
  // one paragraph per thing not being done.
  const notDoing = page.getByRole("textbox", {
    name: "Not doing this year",
    exact: true,
  });
  await expect(notDoing.locator("p")).toHaveText([PRICING, REGIONS]);

  // The pricing rebuild comes off the list. Without a reason it is refused.
  await notDoing.fill(REGIONS);
  await page.getByRole("button", { name: "Replace the frame" }).click();
  // The form's own alert, not the router's announcer, which is one too.
  await expect(
    page.getByRole("alert").filter({ hasText: "needs a written reason" }),
  ).toBeVisible({ timeout: 15_000 });

  // React resets a form with an action once it answers. The editor keeps its
  // text through that, and the edit is typed again anyway, now with its
  // reason, so the spec does not depend on which.
  await notDoing.fill(REGIONS);
  await page.locator('input[name="reason"]').fill(REASON);
  await page.getByRole("button", { name: "Replace the frame" }).click();

  const history = page.getByTestId("frame-revisions");
  await expect(history).toContainText(REASON, { timeout: 15_000 });
  await expect(history).toContainText("Not doing this year");
  await expect(notDoing).toHaveText(REGIONS);
});
