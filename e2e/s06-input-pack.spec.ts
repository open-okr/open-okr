/**
 * The input pack's tick box and its notes (UIUX-PLAN S-06).
 *
 * An owner saved a note on all seven items and every one still read Missing
 * (11 November 2026): the note was stored, and the status changes only with
 * the box beside the item, which was drawn as a dashed red outline with a
 * transparent text tick and did not look like something to press. Now the
 * first note saved into an empty item gathers it, the box looks like a
 * checkbox and says what it does on hover, and after that first note only the
 * box changes the status.
 *
 * **A cycle of its own, years ahead**, made through the API like
 * `s04-cycle-closing.spec.ts`. The claim ticks the current quarter's pack and
 * other specs read that quarter as complete. The quarter is chosen at random,
 * because the API refuses a period that already has a cycle and a retry would
 * otherwise fail on the cycle its first attempt made.
 */
import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

const ITEM = "Customer feedback and market or competitor signals";

test("a first note gathers a pack item, and after that only the box changes it", async ({
  page,
  playwright,
  baseURL,
}) => {
  await signIn(page);
  await goTo(page, "/account/api-tokens");
  await page.getByLabel("Name").fill("Input pack e2e");
  await page.getByRole("checkbox", { name: "Write" }).check();
  await page.getByRole("button", { name: "Create token" }).click();
  const shown = page.getByTestId("minted-token");
  await expect(shown).toBeVisible({ timeout: 10_000 });
  const token = ((await shown.textContent()) ?? "").trim();
  const api: APIRequestContext = await playwright.request.newContext({
    baseURL,
  });
  const year = new Date().getUTCFullYear() + 10 + Math.floor(Math.random() * 80);
  const month = String(1 + 3 * Math.floor(Math.random() * 4)).padStart(2, "0");
  const created = await api.post("/api/v1/cycles/create", {
    headers: { authorization: `Bearer ${token}` },
    data: { on: `${year}-${month}-15`, cadence: "quarterly" },
  });
  expect(created.status(), await created.text()).toBe(200);
  const cycleId = ((await created.json()).data as { id: string }).id;
  await api.dispose();

  await goTo(page, `/cycle?cycle=${cycleId}&phase=1`);
  const row = page.locator("#pack-item-4");
  const tickBox = (gathered: boolean) =>
    row.getByRole("button", {
      name: `Mark "${ITEM}" as ${gathered ? "not gathered" : "gathered"}`,
    });
  const note = row.getByRole("textbox", { name: `Note for "${ITEM}"` });
  const saveNote = async () => {
    const stored = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.request().headers()["next-action"] !== undefined,
    );
    await row.getByRole("button", { name: "Save" }).click();
    await stored;
  };

  await expect(tickBox(false)).toBeVisible({ timeout: 15_000 });
  await expect(row.getByText("Missing", { exact: true })).toBeVisible();
  await expect(page.getByText("0 of 7", { exact: true })).toBeVisible();

  // The box is a checkbox to look at: an icon rather than a text glyph, and a
  // name a sighted person can read on hover.
  await expect(tickBox(false)).toHaveAttribute("aria-pressed", "false");
  await expect(tickBox(false).locator("svg.lucide-check")).toHaveCount(1);
  await expect(tickBox(false)).not.toContainText("✓");
  await tickBox(false).hover();
  await expect(page.getByText("Mark as gathered", { exact: true })).toBeVisible();

  // The first note saved into the empty field gathers the item.
  await note.fill("Priya brings the survey readout");
  await saveNote();
  await expect(tickBox(true)).toBeVisible({ timeout: 15_000 });
  await expect(tickBox(true)).toHaveAttribute("aria-pressed", "true");
  await expect(row.getByText("Gathered", { exact: true })).toBeVisible();
  await expect(page.getByText("1 of 7", { exact: true })).toBeVisible();

  // The box takes it back.
  await tickBox(true).click();
  await expect(tickBox(false)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("0 of 7", { exact: true })).toBeVisible();

  // A note it already had, edited, leaves the status to the box.
  await note.fill("The survey readout moves to next week");
  await saveNote();
  await page.reload();
  await expect(note).toHaveValue("The survey readout moves to next week", {
    timeout: 15_000,
  });
  await expect(tickBox(false)).toBeVisible();
  await expect(row.getByText("Missing", { exact: true })).toBeVisible();
  await expect(page.getByText("0 of 7", { exact: true })).toBeVisible();
});
